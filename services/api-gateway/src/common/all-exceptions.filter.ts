import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { MAX_FILE_SIZE_LABEL } from '../conversions/formats.constants';

/**
 * Single error envelope for every response, mirroring the Credits Service
 * contract:
 *   { error: { code, message, details?, requestId } }
 *
 * - Stable string `code` (client switches on code, never parses message text)
 * - `requestId` = correlation ID for tracing one request across logs
 * - HTTP status is derived from a small code↔status map
 */
const STATUS_TO_CODE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.PAYMENT_REQUIRED]: 'PAYMENT_REQUIRED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = `req_${uuidv4()}`;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        // ValidationPipe returns message as string[] — keep it in details.
        if (Array.isArray(b.message)) {
          message = 'Validation failed';
          details = b.message;
        } else if (typeof b.message === 'string') {
          message = b.message;
        }
      }
    }

    const code = STATUS_TO_CODE[status] || 'INTERNAL';

    // Friendlier message for oversized uploads (states the actual limit).
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      message = `File too large. Maximum allowed size is ${MAX_FILE_SIZE_LABEL}.`;
    }

    // 5xx are real faults — log them with the correlation id.
    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${code}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.status(status).json({
      error: { code, message, ...(details ? { details } : {}), requestId },
    });
  }
}
