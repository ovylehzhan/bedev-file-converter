/**
 * What the client sends when creating a conversion job.
 * The file itself comes via multipart/form-data (handled by Multer).
 */
export class CreateConversionDto {
  targetFormat: string; // e.g. "pdf", "docx", "png"
}
