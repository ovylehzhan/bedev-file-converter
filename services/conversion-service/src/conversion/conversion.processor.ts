import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversionJob } from './conversion-job.entity';
import { CloudConvertService } from './cloudconvert.service';
import { EventPublisherService } from './event-publisher.service';

/**
 * BullMQ Worker — consumes jobs from the "conversions" queue.
 *
 * concurrency = MAX_CONCURRENT_JOBS (default: 30)
 * This IS the rate limiter from the optional task!
 * If 50 requests come in, 30 process simultaneously,
 * 20 wait in the queue.
 */
@Processor('conversions', {
  concurrency: parseInt(process.env.MAX_CONCURRENT_JOBS || '30'),
})
export class ConversionProcessor extends WorkerHost {
  private readonly logger = new Logger(ConversionProcessor.name);
  private readonly publicUrl =
    process.env.PUBLIC_URL || 'http://localhost:3000';

  // Sentinel written by api-gateway's cancel() — lets us tell a user
  // cancellation apart from a transient failure that should be retried.
  private static readonly CANCELLED = 'Cancelled by user';

  private isCancelled(job: ConversionJob): boolean {
    return (
      job.status === 'failed' &&
      job.error === ConversionProcessor.CANCELLED
    );
  }

  constructor(
    @InjectRepository(ConversionJob)
    private readonly jobRepo: Repository<ConversionJob>,
    private readonly cloudConvert: CloudConvertService,
    private readonly eventPublisher: EventPublisherService,
  ) {
    super();
  }

  /**
   * Process a single conversion job.
   * Called automatically by BullMQ when a job is available in the queue.
   */
  async process(job: Job) {
    const { jobId, inputFilePath, sourceFormat, targetFormat, originalFileName } =
      job.data;
    this.logger.log(`Processing job ${jobId}: ${sourceFormat} → ${targetFormat}`);

    // Find the job record in PostgreSQL
    const conversionJob = await this.jobRepo.findOneBy({ id: jobId });
    if (!conversionJob) {
      this.logger.error(`Job ${jobId} not found in database`);
      return;
    }

    // Skip only if the user explicitly cancelled before we picked it up.
    // (A plain "failed" may also be a previous retry attempt — don't skip those.)
    if (this.isCancelled(conversionJob)) {
      this.logger.log(`Job ${jobId} was cancelled, skipping`);
      return;
    }

    // attempts is configured on the queue (default 1). attemptsMade is 0-based.
    const totalAttempts = job.opts?.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= totalAttempts;

    try {
      // Step 7: Update status → in_progress
      conversionJob.status = 'in_progress';
      await this.jobRepo.save(conversionJob);
      await this.eventPublisher.publishJobEvent({
        jobId,
        status: 'in_progress',
      });

      // Steps 9-10: Call CloudConvert API → get result
      const result = await this.cloudConvert.convert(
        inputFilePath,
        sourceFormat,
        targetFormat,
        originalFileName,
      );

      // Guard against a cancel that happened WHILE we were converting:
      // re-read the job; if the user cancelled it (status → failed) we must
      // not overwrite that with "done". (For full atomicity one would use a
      // conditional UPDATE ... WHERE status = 'in_progress'; the re-fetch
      // closes the practical race window for this scope.)
      const current = await this.jobRepo.findOneBy({ id: jobId });
      if (current && this.isCancelled(current)) {
        this.logger.log(
          `Job ${jobId} was cancelled during processing — keeping cancelled state`,
        );
        return;
      }

      // Step 12: Update status → done
      conversionJob.status = 'done';
      conversionJob.cloudConvertJobId = result.cloudConvertJobId;
      conversionJob.resultFileUrl = result.resultUrl;
      await this.jobRepo.save(conversionJob);

      // Step 13: Publish event → Redis PubSub
      await this.eventPublisher.publishJobEvent({
        jobId,
        status: 'done',
        downloadUrl: `${this.publicUrl}/conversions/${jobId}/result`,
      });

      this.logger.log(`Job ${jobId} completed successfully`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Conversion failed';

      if (isLastAttempt) {
        // Final attempt — persist failure and notify the client.
        conversionJob.status = 'failed';
        conversionJob.error = message;
        await this.jobRepo.save(conversionJob);
        await this.eventPublisher.publishJobEvent({
          jobId,
          status: 'failed',
          error: message,
        });
        this.logger.error(`Job ${jobId} failed (final attempt): ${message}`);
      } else {
        // Leave status as in_progress and let BullMQ retry. We don't mark
        // "failed" yet so the retry isn't mistaken for a cancellation.
        this.logger.warn(
          `Job ${jobId} attempt ${job.attemptsMade + 1}/${totalAttempts} failed: ${message} — will retry`,
        );
      }

      // Re-throw so BullMQ schedules the next attempt (or finalizes failure).
      throw error;
    }
  }
}
