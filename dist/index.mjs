import path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import fs from "node:fs/promises";
import Ajv from "ajv";
import YAML from "yaml";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import micromatch from "micromatch";
import Mustache from "mustache";
import zlib from "node:zlib";
import fg from "fast-glob";

//#region src/config.ts
const compressions$1 = [
	"raw",
	"gzip",
	"brotli"
];
const thresholdSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		max_bytes: {
			type: "integer",
			minimum: 0
		},
		fail: { type: "boolean" }
	}
};
const ratchetSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		no_increase: { type: "boolean" },
		fail: { type: "boolean" }
	}
};
const schema = {
	type: "object",
	additionalProperties: false,
	properties: {
		version: { type: "integer" },
		default_branch: { type: "string" },
		comment: {
			type: "object",
			additionalProperties: false,
			properties: {
				enabled: { type: "boolean" },
				key: { type: "string" },
				template: { type: "string" }
			}
		},
		publish: {
			type: "object",
			additionalProperties: false,
			properties: {
				enabled: { type: "boolean" },
				branch: { type: "string" },
				directory: { type: "string" },
				summary_filename: { type: "string" },
				badges_directory: { type: "string" },
				targets_directory: { type: "string" }
			}
		},
		targets: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "files"],
				properties: {
					id: {
						type: "string",
						minLength: 1
					},
					label: { type: "string" },
					files: {
						type: "array",
						minItems: 1,
						items: { type: "string" }
					},
					exclude: {
						type: "array",
						items: { type: "string" }
					},
					compressions: {
						type: "array",
						minItems: 1,
						items: { enum: compressions$1 }
					},
					limits: {
						type: "object",
						additionalProperties: false,
						properties: {
							raw: thresholdSchema,
							gzip: thresholdSchema,
							brotli: thresholdSchema
						}
					},
					ratchet: {
						type: "object",
						additionalProperties: false,
						properties: {
							raw: ratchetSchema,
							gzip: ratchetSchema,
							brotli: ratchetSchema
						}
					},
					badge: {
						type: "object",
						additionalProperties: false,
						properties: {
							label: { type: "string" },
							compression: { enum: compressions$1 },
							colors: {
								type: "object",
								additionalProperties: false,
								properties: {
									ok: { type: "string" },
									warn: { type: "string" },
									error: { type: "string" }
								}
							},
							thresholds: {
								type: "object",
								additionalProperties: false,
								properties: {
									warn_above: {
										type: "integer",
										minimum: 0
									},
									error_above: {
										type: "integer",
										minimum: 0
									}
								}
							}
						}
					}
				}
			}
		}
	},
	required: ["targets"]
};
const validateConfig = new Ajv({ allErrors: true }).compile(schema);
const DEFAULT_COMMENT_TEMPLATE = `{{{marker}}}
## gh-build-size

| Target | Compression | {{base_header}} | {{head_header}} | +/- |
| --- | --- | ---: | ---: | ---: |
{{#rows}}
| {{{label}}} | {{compression}} | {{base}} | {{current}} | {{delta}} |
{{/rows}}

{{#has_violations}}
### Violations
{{#violations}}
- {{label}} ({{compression}}): {{message}}
{{/violations}}
{{/has_violations}}

---
Reported by [gh-build-size](https://github.com/kitsuyui/gh-build-size)`;
function getInputs() {
	return {
		githubToken: core.getInput("github-token", { required: true }),
		configPath: core.getInput("config-path") || ".github/gh-build-size.yml",
		defaultBranch: core.getInput("default-branch") || void 0,
		publishBranch: core.getInput("publish-branch") || void 0,
		commentKey: core.getInput("comment-key") || void 0,
		outputDir: core.getInput("output-dir") || ".gh-build-size"
	};
}
async function loadConfig(configPath) {
	const absolutePath = path.resolve(configPath);
	const raw = await fs.readFile(absolutePath, "utf8");
	const parsed = absolutePath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
	if (!validateConfig(parsed)) throw new Error(`Invalid config: ${JSON.stringify(validateConfig.errors, null, 2)}`);
	return parsed;
}
function normalizeTarget(target) {
	return {
		...target,
		label: target.label ?? target.id,
		compressions: target.compressions ?? [
			"raw",
			"gzip",
			"brotli"
		]
	};
}
function normalizeConfig(config, inputs) {
	return {
		defaultBranch: inputs.defaultBranch ?? config.default_branch,
		comment: {
			enabled: config.comment?.enabled ?? true,
			key: inputs.commentKey ?? config.comment?.key ?? "default",
			template: config.comment?.template ?? DEFAULT_COMMENT_TEMPLATE
		},
		publish: {
			enabled: config.publish?.enabled ?? false,
			branch: inputs.publishBranch ?? config.publish?.branch ?? "gh-build-size",
			directory: config.publish?.directory ?? ".",
			summary_filename: config.publish?.summary_filename ?? "summary.json",
			badges_directory: config.publish?.badges_directory ?? "badges",
			targets_directory: config.publish?.targets_directory ?? "targets"
		},
		targets: config.targets.map(normalizeTarget)
	};
}

//#endregion
//#region src/evaluate.ts
const compressions = [
	"raw",
	"gzip",
	"brotli"
];
function buildViolations(target, current, base) {
	const violations = [];
	for (const compression of target.compressions) {
		const currentValue = current.totals[compression];
		const baseValue = base?.totals[compression];
		const limit = target.limits?.[compression];
		if (limit?.max_bytes !== void 0 && currentValue > limit.max_bytes) violations.push({
			compression,
			kind: "limit",
			message: `${currentValue} B exceeds limit ${limit.max_bytes} B`,
			fail: limit.fail ?? false
		});
		const ratchet = target.ratchet?.[compression];
		if (ratchet?.no_increase && baseValue !== void 0 && currentValue > baseValue) violations.push({
			compression,
			kind: "no_increase",
			message: `${currentValue} B increased from ${baseValue} B`,
			fail: ratchet.fail ?? false
		});
	}
	return violations;
}
function evaluateTargets(config, currentSnapshots, baseSnapshots, touchedFilesByTarget, isPullRequest) {
	return config.targets.map((target) => {
		const current = currentSnapshots.find((item) => item.id === target.id);
		if (!current) throw new Error(`Missing current snapshot for target "${target.id}"`);
		const base = baseSnapshots.find((item) => item.id === target.id);
		const touchedFiles = touchedFilesByTarget.get(target.id) ?? [];
		const commentable = !isPullRequest || touchedFiles.length > 0;
		const violations = buildViolations(target, current, base);
		const sizes = {
			raw: {
				current: current.totals.raw,
				base: base?.totals.raw ?? null,
				delta: base?.totals.raw === void 0 ? null : current.totals.raw - base.totals.raw
			},
			gzip: {
				current: current.totals.gzip,
				base: base?.totals.gzip ?? null,
				delta: base?.totals.gzip === void 0 ? null : current.totals.gzip - base.totals.gzip
			},
			brotli: {
				current: current.totals.brotli,
				base: base?.totals.brotli ?? null,
				delta: base?.totals.brotli === void 0 ? null : current.totals.brotli - base.totals.brotli
			}
		};
		for (const compression of compressions) if (!target.compressions.includes(compression)) sizes[compression] = {
			current: 0,
			base: null,
			delta: null
		};
		return {
			id: target.id,
			label: target.label,
			files: current.files,
			touched_files: touchedFiles,
			commentable,
			sizes,
			violations,
			badge_path: "",
			target_path: ""
		};
	});
}
function countFailingViolations(targets) {
	return targets.reduce((count, target) => count + target.violations.filter((violation) => violation.fail).length, 0);
}

//#endregion
//#region src/git.ts
const execFileAsync = promisify(execFile);
async function execGit(args) {
	const { stdout } = await execFileAsync("git", args, { maxBuffer: 32 * 1024 * 1024 });
	return stdout.trimEnd();
}
async function currentHeadReference() {
	return execGit(["rev-parse", "HEAD"]);
}
async function resolvePullRequestBaseReference(defaultBranch) {
	const baseSha = github.context.payload.pull_request?.base?.sha;
	if (baseSha) return execGit([
		"merge-base",
		baseSha,
		"HEAD"
	]);
	return execGit([
		"merge-base",
		`origin/${defaultBranch}`,
		"HEAD"
	]);
}
async function listChangedFiles(baseReference) {
	const output = await execGit([
		"diff",
		"--name-only",
		`${baseReference}...HEAD`
	]);
	if (!output) return [];
	return output.split("\n").filter(Boolean).sort();
}
function touchedFilesForTarget(target, changedFiles) {
	return micromatch(changedFiles, target.files, { ignore: target.exclude ?? [] }).sort();
}
function createGitRevisionReader() {
	return {
		async listFiles(revision) {
			const output = await execGit([
				"ls-tree",
				"-r",
				"--name-only",
				revision
			]);
			if (!output) return [];
			return output.split("\n").filter(Boolean);
		},
		async readFile(revision, filePath) {
			const { stdout } = await execFileAsync("git", ["show", `${revision}:${filePath}`], {
				encoding: "buffer",
				maxBuffer: 32 * 1024 * 1024
			});
			return Buffer.from(stdout);
		}
	};
}

//#endregion
//#region src/badge.ts
const DEFAULT_COLORS = {
	ok: "2ea44f",
	warn: "dbab09",
	error: "cf222e"
};
function escapeXml(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&apos;");
}
function pickCompression(_target, badge) {
	return badge?.compression ?? "raw";
}
function pickColor(target, badge) {
	const colors = {
		...DEFAULT_COLORS,
		...badge?.colors
	};
	const compression = pickCompression(target, badge);
	const current = target.sizes[compression].current;
	if (target.violations.some((violation) => violation.fail)) return `#${colors.error.replace(/^#/, "")}`;
	if (badge?.thresholds?.error_above !== void 0 && current >= badge.thresholds.error_above) return `#${colors.error.replace(/^#/, "")}`;
	if (badge?.thresholds?.warn_above !== void 0 && current >= badge.thresholds.warn_above) return `#${colors.warn.replace(/^#/, "")}`;
	return `#${colors.ok.replace(/^#/, "")}`;
}
function renderBadge(target, badge) {
	const compression = pickCompression(target, badge);
	const label = badge?.label ?? `${target.label} (${compression})`;
	const value = `${target.sizes[compression].current.toLocaleString("en-US")} B`;
	const escapedLabel = escapeXml(label);
	const escapedValue = escapeXml(value);
	const color = pickColor(target, badge);
	const leftWidth = Math.max(70, 14 + label.length * 7);
	const rightWidth = Math.max(60, 14 + value.length * 7);
	const totalWidth = leftWidth + rightWidth;
	const rightCenter = leftWidth + rightWidth / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escapedLabel}: ${escapedValue}">
<title>${escapedLabel}: ${escapedValue}</title>
<linearGradient id="smooth" x2="0" y2="100%">
<stop offset="0" stop-color="#fff" stop-opacity=".7"/>
<stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
<stop offset=".9" stop-opacity=".3"/>
<stop offset="1" stop-opacity=".5"/>
</linearGradient>
<clipPath id="round"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#round)">
<rect width="${leftWidth}" height="20" fill="#555"/>
<rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
<rect width="${totalWidth}" height="20" fill="url(#smooth)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${leftWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapedLabel}</text>
<text x="${leftWidth / 2}" y="14">${escapedLabel}</text>
<text x="${rightCenter}" y="15" fill="#010101" fill-opacity=".3">${escapedValue}</text>
<text x="${rightCenter}" y="14">${escapedValue}</text>
</g>
</svg>
`;
}

//#endregion
//#region src/comment.ts
function formatBytes(value) {
	if (value === null) return "n/a";
	return `${value.toLocaleString("en-US")} B`;
}
function formatDelta(value) {
	if (value === null) return "n/a";
	if (value === 0) return "0 B";
	return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")} B`;
}
function buildMarker(key) {
	return `<!-- gh-build-size:${key} -->`;
}
function renderComment(summary, template, marker) {
	const rows = summary.targets.filter((target) => target.commentable).flatMap((target) => [
		"raw",
		"gzip",
		"brotli"
	].filter((compression) => target.sizes[compression].base !== null || target.sizes[compression].current > 0).map((compression) => ({
		label: `\`${target.label}\``,
		compression,
		base: formatBytes(target.sizes[compression].base),
		current: formatBytes(target.sizes[compression].current),
		delta: formatDelta(target.sizes[compression].delta)
	})));
	const violations = summary.targets.flatMap((target) => target.violations.map((violation) => ({
		label: target.label,
		compression: violation.compression,
		message: violation.message
	})));
	return Mustache.render(template, {
		marker,
		base_header: summary.base_label,
		head_header: summary.head_label,
		rows,
		violations,
		has_violations: violations.length > 0
	});
}
function decideCommentAction(existing, nextBody) {
	if (!existing && !nextBody) return { type: "skip" };
	if (!existing && nextBody) return {
		type: "create",
		body: nextBody
	};
	if (existing && !nextBody) return {
		type: "delete",
		commentId: existing.id
	};
	if (existing && nextBody && existing.body !== nextBody) return {
		type: "update",
		commentId: existing.id,
		body: nextBody
	};
	return { type: "skip" };
}

//#endregion
//#region src/github.ts
function isPermissionError(error) {
	if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") return [
		401,
		403,
		404
	].includes(error.status);
	return false;
}
async function findManagedComment(octokit, marker) {
	const issueNumber = github.context.payload.pull_request?.number;
	if (!issueNumber) return null;
	const found = (await octokit.paginate(octokit.rest.issues.listComments, {
		...github.context.repo,
		issue_number: issueNumber,
		per_page: 100
	})).find((comment) => comment.body?.includes(marker));
	if (!found?.body) return null;
	return {
		id: found.id,
		body: found.body
	};
}
async function updatePullRequestComment(octokit, summary, config) {
	const issueNumber = github.context.payload.pull_request?.number;
	if (!issueNumber || !config.comment.enabled) return;
	const marker = buildMarker(config.comment.key);
	const body = summary.targets.some((target) => target.commentable) ? renderComment(summary, config.comment.template, marker) : null;
	try {
		const action = decideCommentAction(await findManagedComment(octokit, marker), body);
		if (action.type === "create") await octokit.rest.issues.createComment({
			...github.context.repo,
			issue_number: issueNumber,
			body: action.body
		});
		else if (action.type === "update") await octokit.rest.issues.updateComment({
			...github.context.repo,
			comment_id: action.commentId,
			body: action.body
		});
		else if (action.type === "delete") await octokit.rest.issues.deleteComment({
			...github.context.repo,
			comment_id: action.commentId
		});
	} catch (error) {
		if (isPermissionError(error)) {
			core.warning("gh-build-size skipped PR comment updates because the workflow token cannot write pull request comments.");
			return;
		}
		throw error;
	}
}
async function fetchPublishedJson(octokit, branch, filename) {
	try {
		const response = await octokit.rest.repos.getContent({
			...github.context.repo,
			path: filename,
			ref: branch
		});
		if (!("content" in response.data) || typeof response.data.content !== "string") return null;
		return JSON.parse(Buffer.from(response.data.content, "base64").toString("utf8"));
	} catch (error) {
		if (isPermissionError(error)) return null;
		throw error;
	}
}
async function fetchPublishedSummary(octokit, branch, summaryFilename) {
	return fetchPublishedJson(octokit, branch, summaryFilename);
}
async function ensureBranch(octokit, branch) {
	try {
		return { commitSha: (await octokit.rest.git.getRef({
			...github.context.repo,
			ref: `heads/${branch}`
		})).data.object.sha };
	} catch (error) {
		if (!isPermissionError(error)) throw error;
	}
	return { commitSha: null };
}
async function publishAssets(octokit, summary, targetStatuses, snapshots, config) {
	if (!config.publish.enabled || !summary.publish_branch) return;
	const branch = summary.publish_branch;
	try {
		const branchState = await ensureBranch(octokit, branch);
		const treeEntries = [{
			path: path.posix.join(config.publish.directory, config.publish.summary_filename),
			mode: "100644",
			type: "blob",
			content: `${JSON.stringify(summary, null, 2)}\n`
		}];
		for (const target of targetStatuses) {
			const targetConfig = config.targets.find((item) => item.id === target.id);
			const snapshot = snapshots.find((item) => item.id === target.id);
			if (!targetConfig || !snapshot) continue;
			treeEntries.push({
				path: path.posix.join(config.publish.directory, config.publish.badges_directory, `${target.id}.svg`),
				mode: "100644",
				type: "blob",
				content: renderBadge(target, targetConfig.badge)
			});
			treeEntries.push({
				path: path.posix.join(config.publish.directory, config.publish.targets_directory, `${target.id}.json`),
				mode: "100644",
				type: "blob",
				content: `${JSON.stringify(snapshot, null, 2)}\n`
			});
		}
		const tree = await octokit.rest.git.createTree({
			...github.context.repo,
			tree: treeEntries
		});
		const commit = await octokit.rest.git.createCommit({
			...github.context.repo,
			message: "Update gh-build-size assets",
			tree: tree.data.sha,
			parents: branchState.commitSha ? [branchState.commitSha] : []
		});
		if (branchState.commitSha) await octokit.rest.git.updateRef({
			...github.context.repo,
			ref: `heads/${branch}`,
			sha: commit.data.sha,
			force: true
		});
		else await octokit.rest.git.createRef({
			...github.context.repo,
			ref: `refs/heads/${branch}`,
			sha: commit.data.sha
		});
	} catch (error) {
		if (isPermissionError(error)) {
			core.warning(`gh-build-size skipped publish-branch updates because the workflow token cannot write branch "${branch}".`);
			return;
		}
		throw error;
	}
}
async function writeOutputFiles(outputDir, summary, targetStatuses, snapshots, config) {
	await fs.mkdir(outputDir, { recursive: true });
	await fs.mkdir(path.join(outputDir, "badges"), { recursive: true });
	await fs.mkdir(path.join(outputDir, "targets"), { recursive: true });
	const summaryPath = path.join(outputDir, "summary.json");
	await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
	for (const target of targetStatuses) {
		const targetConfig = config.targets.find((item) => item.id === target.id);
		const snapshot = snapshots.find((item) => item.id === target.id);
		if (!targetConfig || !snapshot) continue;
		await fs.writeFile(path.join(outputDir, "badges", `${target.id}.svg`), renderBadge(target, targetConfig.badge));
		await fs.writeFile(path.join(outputDir, "targets", `${target.id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
	}
	core.setOutput("summary-path", summaryPath);
	core.setOutput("summary-json", JSON.stringify(summary));
}

//#endregion
//#region src/measure.ts
const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);
async function compressBuffer(compression, content) {
	if (compression === "raw") return content.byteLength;
	if (compression === "gzip") return (await gzip(content)).byteLength;
	return (await brotliCompress(content, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } })).byteLength;
}
async function filesForWorkspace(target) {
	return (await fg(target.files, {
		dot: false,
		onlyFiles: true,
		ignore: target.exclude ?? [],
		unique: true
	})).sort();
}
function filesForRevision(allFiles, target) {
	return micromatch(allFiles, target.files, { ignore: target.exclude ?? [] }).sort();
}
async function measureFiles(files, compressions, readFile) {
	const totals = {
		raw: 0,
		gzip: 0,
		brotli: 0
	};
	for (const filePath of files) {
		const content = await readFile(filePath);
		for (const compression of compressions) totals[compression] += await compressBuffer(compression, content);
	}
	return totals;
}
async function measureWorkspaceTargets(targets) {
	return Promise.all(targets.map(async (target) => {
		const files = await filesForWorkspace(target);
		const totals = await measureFiles(files, target.compressions, (filePath) => fs.readFile(filePath));
		return {
			id: target.id,
			label: target.label,
			files,
			totals
		};
	}));
}
async function measureRevisionTargets(revision, targets, reader) {
	const revisionFiles = await reader.listFiles(revision);
	return Promise.all(targets.map(async (target) => {
		const files = filesForRevision(revisionFiles, target);
		const totals = await measureFiles(files, target.compressions, (filePath) => reader.readFile(revision, filePath));
		return {
			id: target.id,
			label: target.label,
			files,
			totals
		};
	}));
}

//#endregion
//#region src/index.ts
async function resolveDefaultBranch(configDefault) {
	return configDefault ?? github.context.payload.repository?.default_branch ?? "main";
}
function attachOutputPaths(summary, outputDir) {
	return {
		...summary,
		targets: summary.targets.map((target) => ({
			...target,
			badge_path: path.join(outputDir, "badges", `${target.id}.svg`),
			target_path: path.join(outputDir, "targets", `${target.id}.json`)
		}))
	};
}
function buildSummary(defaultBranch, publishBranch, baseLabel, baseReference, headLabel, headReference, targets) {
	return {
		generated_at: (/* @__PURE__ */ new Date()).toISOString(),
		repository: github.context.payload.repository?.full_name ?? "",
		default_branch: defaultBranch,
		publish_branch: publishBranch,
		event_name: github.context.eventName,
		base_label: baseLabel,
		base_reference: baseReference,
		head_label: headLabel,
		head_reference: headReference,
		targets
	};
}
async function run() {
	const inputs = getInputs();
	const config = normalizeConfig(await loadConfig(inputs.configPath), inputs);
	const defaultBranch = await resolveDefaultBranch(config.defaultBranch);
	const octokit = github.getOctokit(inputs.githubToken);
	const headReference = await currentHeadReference();
	const currentSnapshots = await measureWorkspaceTargets(config.targets);
	let baseReference = null;
	const baseLabel = defaultBranch;
	let headLabel = defaultBranch;
	let baseSnapshots = [];
	let changedFiles = [];
	if (github.context.eventName === "pull_request") {
		baseReference = await resolvePullRequestBaseReference(defaultBranch);
		changedFiles = await listChangedFiles(baseReference);
		baseSnapshots = await measureRevisionTargets(baseReference, config.targets, createGitRevisionReader());
		headLabel = `#${github.context.payload.pull_request?.number ?? "pr"}`;
	} else if (github.context.eventName === "push" && github.context.ref === `refs/heads/${defaultBranch}` && config.publish.enabled) {
		const publishedSummary = await fetchPublishedSummary(octokit, config.publish.branch, path.posix.join(config.publish.directory, config.publish.summary_filename));
		baseReference = publishedSummary?.head_reference ?? null;
		baseSnapshots = publishedSummary?.targets.map((target) => ({
			id: target.id,
			label: target.label,
			files: target.files,
			totals: {
				raw: target.sizes.raw.current,
				gzip: target.sizes.gzip.current,
				brotli: target.sizes.brotli.current
			}
		})) ?? [];
	}
	const touchedFilesByTarget = new Map(config.targets.map((target) => [target.id, touchedFilesForTarget(target, changedFiles)]).filter(([, touchedFiles]) => touchedFiles.length > 0));
	const evaluatedTargets = evaluateTargets(config, currentSnapshots, baseSnapshots, touchedFilesByTarget, github.context.eventName === "pull_request");
	const publishBranch = github.context.eventName === "push" && github.context.ref === `refs/heads/${defaultBranch}` && config.publish.enabled ? config.publish.branch : null;
	const summary = attachOutputPaths(buildSummary(defaultBranch, publishBranch, baseLabel, baseReference, headLabel, headReference, evaluatedTargets), inputs.outputDir);
	await writeOutputFiles(inputs.outputDir, summary, evaluatedTargets, currentSnapshots, config);
	if (github.context.eventName === "pull_request") await updatePullRequestComment(octokit, summary, config);
	if (publishBranch) await publishAssets(octokit, summary, evaluatedTargets, currentSnapshots, config);
	const failingViolations = countFailingViolations(evaluatedTargets);
	core.setOutput("violation-count", String(failingViolations));
	core.setOutput("has-violations", String(failingViolations > 0));
	core.setOutput("publish-branch", publishBranch ?? "");
	if (failingViolations > 0) core.setFailed(`gh-build-size detected ${failingViolations} failing size violation(s).`);
}
run().catch((error) => {
	if (error instanceof Error) {
		core.setFailed(error.message);
		return;
	}
	core.setFailed(String(error));
});

//#endregion
export {  };
//# sourceMappingURL=index.mjs.map