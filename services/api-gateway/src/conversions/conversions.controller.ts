import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Sse,
  UseInterceptors,
  UploadedFile,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { ConversionsService } from './conversions.service';
import { SseService } from './sse.service';
import { CreateConversionDto } from './dto/create-conversion.dto';

/**
 * All endpoints from the Notion spec:
 *
 * REQUIRED:
 *   POST   /conversions              — upload file + start conversion
 *   GET    /conversions/:jobId/status — check job status
 *   GET    /conversions/:jobId/events — SSE subscription
 *   GET    /conversions/:jobId/result — download result
 *
 * OPTIONAL (implemented for max score):
 *   GET    /conversions              — list all jobs
 *   GET    /conversions/:jobId       — job details
 *   POST   /conversions/:jobId/cancel — cancel job
 */
@Controller('conversions')
export class ConversionsController {
  constructor(
    private readonly conversionsService: ConversionsService,
    private readonly sseService: SseService,
  ) {}

  /**
   * POST /conversions
   * Upload a file and create a conversion job.
   * File comes as multipart/form-data field "file".
   */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateConversionDto,
  ) {
    const job = await this.conversionsService.create(file, dto);
    return { jobId: job.id, status: job.status };
  }

  /** GET /conversions — list all conversion jobs */
  @Get()
  async findAll() {
    return this.conversionsService.findAll();
  }

  /** GET /conversions/:jobId — full job details */
  @Get(':jobId')
  async findOne(@Param('jobId') jobId: string) {
    return this.conversionsService.findOne(jobId);
  }

  /** GET /conversions/:jobId/status — check status */
  @Get(':jobId/status')
  async getStatus(@Param('jobId') jobId: string) {
    return this.conversionsService.getStatus(jobId);
  }

  /**
   * GET /conversions/:jobId/events — SSE endpoint
   *
   * Opens a persistent connection. Browser keeps it open
   * and receives events as they happen:
   *   event: status     → {"jobId":"...", "status":"in_progress"}
   *   event: completed  → {"jobId":"...", "status":"done", "downloadUrl":"..."}
   *   event: failed     → {"jobId":"...", "status":"failed", "error":"..."}
   *
   * Test in browser: http://localhost:3000/conversions/job_123/events
   */
  @Sse(':jobId/events')
  events(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return this.sseService.getJobEvents(jobId);
  }

  /** GET /conversions/:jobId/result — get conversion result */
  @Get(':jobId/result')
  async getResult(@Param('jobId') jobId: string) {
    return this.conversionsService.getResult(jobId);
  }

  /** POST /conversions/:jobId/cancel — cancel a job */
  @Post(':jobId/cancel')
  @HttpCode(200)
  async cancel(@Param('jobId') jobId: string) {
    return this.conversionsService.cancel(jobId);
  }
}
