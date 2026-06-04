/**
 * Supported conversion formats and file-size limits.
 * Single source of truth — referenced by the service (format whitelist)
 * and the Multer config (size limit).
 *
 * Based on the homework spec: PDF, DOCX, XLSX, PPTX, PNG, JPG, ≤ 2 GB.
 */

// jpeg is accepted as an alias for jpg
export const SUPPORTED_FORMATS = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'png',
  'jpg',
  'jpeg',
] as const;

export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const MAX_FILE_SIZE_LABEL = '2 GB';

/** Case-insensitive check that a format is in the whitelist. */
export function isSupportedFormat(format: string): boolean {
  return SUPPORTED_FORMATS.includes(
    format.toLowerCase() as SupportedFormat,
  );
}
