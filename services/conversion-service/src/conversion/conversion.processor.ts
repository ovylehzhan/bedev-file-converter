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

    // Skip if already cancelled by user
    if (conversionJob.status === 'failed') {
      this.logger.log(`Job ${jobId} was cancelled, skipping`);
      return;
    }

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
      if (current?.status === 'failed') {
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
        downloadUrl: `http://localhost:3000/conversions/${jobId}/result`,
      });

      this.logger.log(`Job ${jobId} completed successfully`);
    } catch (error) {
      // Step 12: Update status → failed
      conversionJob.status = 'failed';
      conversionJob.error =
        error instanceof Error ? error.message : 'Conversion failed';
      await this.jobRepo.save(conversionJob);

      // Step 13: Publish failure event
      await this.eventPublisher.publishJobEvent({
        jobId,
        status: 'failed',
        error: conversionJob.error,
      });

      this.logger.error(`Job ${jobId} failed: ${conversionJob.error}`);
    }
  }
}
