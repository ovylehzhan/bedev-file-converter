import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import { MulterError } from 'multer';
import { Response } from 'express';
import { MAX_FILE_SIZE_LABEL } from './formats.constants';

/**
 * Turns file-upload size errors into a clean, friendly 413.
 *
 * NestJS's platform-express integration converts Multer's LIMIT_FILE_SIZE
 * into a PayloadTooLargeException ("File too large") before a plain
 * @Catch(MulterError) filter would see it — so we catch BOTH and replace
 * the message with one that states the actual limit.
 */
@Catch(MulterError, PayloadTooLargeException)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(
    exception: MulterError | PayloadTooLargeException,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();
    const isMulter = exception instanceof MulterError;
    const tooLarge =
      exception instanceof PayloadTooLargeException ||
      (isMulter && exception.code === 'LIMIT_FILE_SIZE');

    const status = tooLarge
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : HttpStatus.BAD_REQUEST;

    response.status(status).json({
      statusCode: status,
      error: tooLarge ? 'Payload Too Large' : 'Bad Request',
      message: tooLarge
        ? `File too large. Maximum allowed size is ${MAX_FILE_SIZE_LABEL}.`
        : (exception as MulterError).message,
    });
  }
}
