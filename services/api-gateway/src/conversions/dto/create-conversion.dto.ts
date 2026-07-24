import { IsNotEmpty, IsString } from 'class-validator';

/**
 * What the client sends when creating a conversion job.
 * The file itself comes via multipart/form-data (handled by Multer).
 *
 * Generic input validation lives here (presence + type), enforced by the
 * global ValidationPipe. Domain rules (format whitelist, case-insensitive)
 * stay in the service.
 */
export class CreateConversionDto {
  @IsString()
  @IsNotEmpty()
  targetFormat: string; // e.g. "pdf", "docx", "png"
}
