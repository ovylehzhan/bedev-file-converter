import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { ConversionJob } from './conversion-job.entity';
import { CreateConversionDto } from './dto/create-conversion.dto';
import { SUPPORTED_FORMATS, isSupportedFormat } from './formats.constants';
import { EventPublisherService } from './event-publisher.service';

@Injectable()
export class ConversionsService {
  constructor(
    // TypeORM injects the repository for ConversionJob entity
    @InjectRepository(ConversionJob)
    private readonly jobRepo: Repository<ConversionJob>,

    // BullMQ injects the "conversions" queue (shared with conversion-service)
    @InjectQueue('conversions')
    private readonly conversionQueue: Queue,

    // Publishes events to Redis PubSub (used by cancel — see below)
    private readonly eventPublisher: EventPublisherService,
  ) {}

  /**
   * Create a new conversion job:
   * 1. Save job metadata to PostgreSQL (status: pending)
   * 2. Add job to BullMQ queue (conversion-service will pick it up)
   * 3. Return jobId to client immediately (async processing)
   */
  async create(
    file: Express.Multer.File,
    dto: CreateConversionDto,
    idempotencyKey?: string,
  ): Promise<ConversionJob> {
    // Idempotency: if the client retried with the same key, return the job
    // we already created instead of making a new one (which would enqueue a
    // second CloudConvert conversion and double-spend a paid credit).
    if (idempotencyKey) {
      const existing = await this.jobRepo.findOneBy({ idempotencyKey });
      if (existing) {
        return existing;
      }
    }

    const jobId = `job_${uuidv4().slice(0, 8)}`;
    const sourceFormat = path
      .extname(file.originalname)
      .replace('.', '')
      .toLowerCase();
    const targetFormat = dto.targetFormat?.toLowerCase();

    // Validate formats against the whitelist (fail fast with a clear 400
    // instead of letting CloudConvert reject it later).
    if (!sourceFormat) {
      throw new BadRequestException(
        'Uploaded file has no extension — cannot detect source format.',
      );
    }
    if (!isSupportedFormat(sourceFormat)) {
      throw new BadRequestException(
        `Unsupported source format ".${sourceFormat}". Supported: ${SUPPORTED_FORMATS.join(', ')}`,
      );
    }
    if (!targetFormat) {
      throw new BadRequestException('targetFormat is required.');
    }
    if (!isSupportedFormat(targetFormat)) {
      throw new BadRequestException(
        `Unsupported target format ".${targetFormat}". Supported: ${SUPPORTED_FORMATS.join(', ')}`,
      );
    }

    const job = this.jobRepo.create({
      id: jobId,
      originalFileName: file.originalname,
      sourceFormat,
      targetFormat,
      status: 'pending',
      inputFilePath: file.path,
      idempotencyKey: idempotencyKey || undefined,
    });

    // Step 3 from diagram: Create job (status: pending) → Job Storage
    await this.jobRepo.save(job);

    // Step 4 from diagram: Add job to queue → Queue (Redis/BullMQ)
    // attempts + exponential backoff: a transient CloudConvert/network
    // failure is retried up to 3 times instead of failing the job outright.
    await this.conversionQueue.add(
      'convert',
      {
        jobId,
        inputFilePath: file.path,
        originalFileName: file.originalname,
        sourceFormat,
        targetFormat,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      },
    );

    return job;
  }

  /** GET /conversions — list all jobs (optional endpoint) */
  async findAll(): Promise<ConversionJob[]> {
    return this.jobRepo.find({ order: { createdAt: 'DESC' } });
  }

  /** GET /conversions/:jobId — full job details (optional endpoint) */
  async findOne(jobId: string): Promise<ConversionJob> {
    const job = await this.jobRepo.findOneBy({ id: jobId });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    return job;
  }

  /**
   * GET /conversions/:jobId/status
   * Returns different response shapes depending on status
   * (exactly as specified in Notion assignment)
   */
  async getStatus(jobId: string) {
    const job = await this.findOne(jobId);

    const response: Record<string, any> = {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    if (job.status === 'done') {
      const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
      response.downloadUrl = `${publicUrl}/conversions/${job.id}/result`;
    }

    if (job.status === 'failed') {
      response.error = job.error;
    }

    return response;
  }

  /**
   * GET /conversions/:jobId/result
   * Returns download URL if ready, or "not ready" message
   */
  async getResult(jobId: string) {
    const job = await this.findOne(jobId);

    if (job.status !== 'done') {
      return {
        jobId: job.id,
        status: job.status,
        message: 'File is not ready yet',
      };
    }

    return {
      jobId: job.id,
      status: 'done',
      downloadUrl: job.resultFileUrl,
    };
  }

  /**
   * POST /conversions/:jobId/cancel
   * Limitation: if CloudConvert job is already running,
   * we can only mark our local job as failed.
   * This is documented in README.
   */
  async cancel(jobId: string) {
    const job = await this.findOne(jobId);

    if (job.status === 'done' || job.status === 'failed') {
      return { jobId: job.id, message: `Job already ${job.status}` };
    }

    job.status = 'failed';
    job.error = 'Cancelled by user';
    await this.jobRepo.save(job);

    // Publish so SSE clients connected right now get the cancel in real time
    // (conversion-service won't publish it — the cancel happens here).
    await this.eventPublisher.publishJobEvent({
      jobId: job.id,
      status: 'failed',
      error: 'Cancelled by user',
    });

    return { jobId: job.id, status: 'failed', message: 'Job cancelled' };
  }
}
