import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { MulterError } from 'multer';
import { Response } from 'express';
import { MAX_FILE_SIZE_LABEL } from './formats.constants';

/**
 * Turns Multer errors into clean JSON responses.
 * Most important: file-size limit exceeded → 413 Payload Too Large
 * (instead of the default 500).
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const tooLarge = exception.code === 'LIMIT_FILE_SIZE';
    const status = tooLarge
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : HttpStatus.BAD_REQUEST;

    response.status(status).json({
      statusCode: status,
      error: tooLarge ? 'Payload Too Large' : 'Bad Request',
      message: tooLarge
        ? `File too large. Maximum allowed size is ${MAX_FILE_SIZE_LABEL}.`
        : exception.message,
    });
  }
}
