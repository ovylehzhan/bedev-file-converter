import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { ConversionProcessor } from './conversion.processor';
import { ConversionJob } from './conversion-job.entity';
import { CloudConvertService } from './cloudconvert.service';
import { EventPublisherService } from './event-publisher.service';

/**
 * Unit tests for ConversionProcessor — the core worker logic.
 * All dependencies are mocked. We instantiate the processor directly
 * (not via NestJS) to avoid spinning up a real BullMQ worker.
 */
describe('ConversionProcessor', () => {
  let processor: ConversionProcessor;
  let repo: jest.Mocked<Repository<ConversionJob>>;
  let cloudConvert: jest.Mocked<CloudConvertService>;
  let eventPublisher: jest.Mocked<EventPublisherService>;

  // attemptsMade is 0-based; attempts is the configured max (default 1).
  const makeJob = (data: object, attemptsMade = 0, attempts = 1): Job =>
    ({ data, attemptsMade, opts: { attempts } } as unknown as Job);

  beforeEach(() => {
    repo = {
      findOneBy: jest.fn(),
      save: jest.fn((j) => Promise.resolve(j)),
    } as any;

    cloudConvert = {
      convert: jest.fn(),
    } as any;

    eventPublisher = {
      publishJobEvent: jest.fn(() => Promise.resolve()),
    } as any;

    processor = new ConversionProcessor(repo, cloudConvert, eventPublisher);
  });

  const jobData = {
    jobId: 'job_123',
    inputFilePath: '/app/uploads/abc',
    sourceFormat: 'docx',
    targetFormat: 'pdf',
    originalFileName: 'contract.docx',
  };

  it('does nothing if the job is not in the database', async () => {
    repo.findOneBy.mockResolvedValue(null);

    await processor.process(makeJob(jobData));

    expect(cloudConvert.convert).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('skips a job that was cancelled before pickup (failed + cancel sentinel)', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 'job_123',
      status: 'failed',
      error: 'Cancelled by user',
    } as ConversionJob);

    await processor.process(makeJob(jobData));

    expect(cloudConvert.convert).not.toHaveBeenCalled();
  });

  it('on success: sets in_progress then done, and publishes both events', async () => {
    const job = { id: 'job_123', status: 'pending' } as ConversionJob;
    repo.findOneBy.mockResolvedValue(job);
    cloudConvert.convert.mockResolvedValue({
      resultUrl: 'https://cloudconvert.com/result.pdf',
      cloudConvertJobId: 'cc_999',
    });

    await processor.process(makeJob(jobData));

    // CloudConvert must receive the original filename (with extension)
    // — regression guard for the INVALID_FILENAME bug
    expect(cloudConvert.convert).toHaveBeenCalledWith(
      '/app/uploads/abc',
      'docx',
      'pdf',
      'contract.docx',
    );

    // Final state persisted
    expect(job.status).toBe('done');
    expect(job.resultFileUrl).toBe('https://cloudconvert.com/result.pdf');
    expect(job.cloudConvertJobId).toBe('cc_999');

    // Both lifecycle events published, in order
    expect(eventPublisher.publishJobEvent).toHaveBeenNthCalledWith(1, {
      jobId: 'job_123',
      status: 'in_progress',
    });
    expect(eventPublisher.publishJobEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ jobId: 'job_123', status: 'done' }),
    );
  });

  it('does NOT overwrite to done if the job was cancelled during processing', async () => {
    const job = { id: 'job_123', status: 'pending' } as ConversionJob;
    // First load → pending; re-fetch after convert → cancelled (failed)
    repo.findOneBy
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({
        id: 'job_123',
        status: 'failed',
        error: 'Cancelled by user',
      } as ConversionJob);
    cloudConvert.convert.mockResolvedValue({
      resultUrl: 'https://cloudconvert.com/result.pdf',
      cloudConvertJobId: 'cc_999',
    });

    await processor.process(makeJob(jobData));

    // The "done" event must NOT be published — cancel wins
    expect(eventPublisher.publishJobEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('on last-attempt error: sets failed, publishes failed event, and re-throws', async () => {
    const job = { id: 'job_123', status: 'pending' } as ConversionJob;
    repo.findOneBy.mockResolvedValue(job);
    cloudConvert.convert.mockRejectedValue(new Error('Unauthorized'));

    // attemptsMade=0, attempts=1 → this IS the last attempt
    await expect(processor.process(makeJob(jobData, 0, 1))).rejects.toThrow(
      'Unauthorized',
    );

    expect(job.status).toBe('failed');
    expect(job.error).toBe('Unauthorized');
    expect(eventPublisher.publishJobEvent).toHaveBeenLastCalledWith({
      jobId: 'job_123',
      status: 'failed',
      error: 'Unauthorized',
    });
  });

  it('on non-last-attempt error: does NOT mark failed, re-throws so BullMQ retries', async () => {
    const job = { id: 'job_123', status: 'pending' } as ConversionJob;
    repo.findOneBy.mockResolvedValue(job);
    cloudConvert.convert.mockRejectedValue(new Error('network blip'));

    // attemptsMade=0, attempts=3 → NOT the last attempt
    await expect(processor.process(makeJob(jobData, 0, 3))).rejects.toThrow(
      'network blip',
    );

    // No "failed" persisted or published yet — the retry will run
    expect(job.status).not.toBe('failed');
    expect(eventPublisher.publishJobEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
