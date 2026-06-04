export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024

export function assertFileWithinMaxBytes(
  filePath: string,
  byteLength: number,
  maxFileBytes: number,
): void {
  if (byteLength > maxFileBytes) {
    throw new Error(
      `File "${filePath}" is ${byteLength} bytes, which exceeds max_file_bytes (${maxFileBytes}).`,
    )
  }
}
