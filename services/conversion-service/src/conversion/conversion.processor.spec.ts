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

  const makeJob = (data: object): Job =>
    ({ data } as Job);

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
  };

  it('does nothing if the job is not in the database', async () => {
    repo.findOneBy.mockResolvedValue(null);

    await processor.process(makeJob(jobData));

    expect(cloudConvert.convert).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('skips a job that was already cancelled (status failed)', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 'job_123',
      status: 'failed',
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

  it('on CloudConvert error: sets failed and publishes failed event with message', async () => {
    const job = { id: 'job_123', status: 'pending' } as ConversionJob;
    repo.findOneBy.mockResolvedValue(job);
    cloudConvert.convert.mockRejectedValue(new Error('Unauthorized'));

    await processor.process(makeJob(jobData));

    expect(job.status).toBe('failed');
    expect(job.error).toBe('Unauthorized');
    expect(eventPublisher.publishJobEvent).toHaveBeenLastCalledWith({
      jobId: 'job_123',
      status: 'failed',
      error: 'Unauthorized',
    });
  });
});
