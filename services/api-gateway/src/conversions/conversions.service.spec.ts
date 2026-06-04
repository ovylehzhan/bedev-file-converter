import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { ConversionsService } from './conversions.service';
import { ConversionJob } from './conversion-job.entity';

/**
 * Unit tests for ConversionsService.
 * Repository and Queue are mocked — no real DB or Redis needed.
 */
describe('ConversionsService', () => {
  let service: ConversionsService;
  let repo: jest.Mocked<Repository<ConversionJob>>;
  let queue: jest.Mocked<Queue>;

  beforeEach(async () => {
    // Mock TypeORM repository
    const repoMock = {
      create: jest.fn((dto) => dto as ConversionJob),
      save: jest.fn((job) => Promise.resolve(job)),
      find: jest.fn(),
      findOneBy: jest.fn(),
    };

    // Mock BullMQ queue
    const queueMock = {
      add: jest.fn(() => Promise.resolve()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversionsService,
        { provide: getRepositoryToken(ConversionJob), useValue: repoMock },
        { provide: getQueueToken('conversions'), useValue: queueMock },
      ],
    }).compile();

    service = module.get(ConversionsService);
    repo = module.get(getRepositoryToken(ConversionJob));
    queue = module.get(getQueueToken('conversions'));
  });

  describe('create', () => {
    const fakeFile = {
      originalname: 'contract.docx',
      path: '/app/uploads/abc123',
    } as Express.Multer.File;

    it('creates a job with pending status and a job_ prefixed id', async () => {
      const job = await service.create(fakeFile, { targetFormat: 'pdf' });

      expect(job.id).toMatch(/^job_[a-f0-9]{8}$/);
      expect(job.status).toBe('pending');
      expect(job.sourceFormat).toBe('docx'); // extracted from filename
      expect(job.targetFormat).toBe('pdf');
      expect(job.originalFileName).toBe('contract.docx');
    });

    it('saves the job to the database', async () => {
      await service.create(fakeFile, { targetFormat: 'pdf' });
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('adds the job to the conversion queue', async () => {
      const job = await service.create(fakeFile, { targetFormat: 'pdf' });
      expect(queue.add).toHaveBeenCalledWith(
        'convert',
        expect.objectContaining({
          jobId: job.id,
          sourceFormat: 'docx',
          targetFormat: 'pdf',
        }),
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('normalizes formats to lowercase', async () => {
      const upper = {
        originalname: 'REPORT.DOCX',
        path: '/app/uploads/x',
      } as Express.Multer.File;
      const job = await service.create(upper, { targetFormat: 'PDF' });
      expect(job.sourceFormat).toBe('docx');
      expect(job.targetFormat).toBe('pdf');
    });

    it('rejects an unsupported source format', async () => {
      const exe = {
        originalname: 'virus.exe',
        path: '/app/uploads/x',
      } as Express.Multer.File;
      await expect(
        service.create(exe, { targetFormat: 'pdf' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects an unsupported target format', async () => {
      await expect(
        service.create(fakeFile, { targetFormat: 'mp3' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a file with no extension', async () => {
      const noExt = {
        originalname: 'noextension',
        path: '/app/uploads/x',
      } as Express.Multer.File;
      await expect(
        service.create(noExt, { targetFormat: 'pdf' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('returns the job when found', async () => {
      const job = { id: 'job_123', status: 'done' } as ConversionJob;
      repo.findOneBy.mockResolvedValue(job);

      await expect(service.findOne('job_123')).resolves.toBe(job);
    });

    it('throws NotFoundException when job does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('job_missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getStatus', () => {
    it('includes downloadUrl when status is done', async () => {
      repo.findOneBy.mockResolvedValue({
        id: 'job_123',
        status: 'done',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ConversionJob);

      const result = await service.getStatus('job_123');

      expect(result.status).toBe('done');
      expect(result.downloadUrl).toContain('/conversions/job_123/result');
      expect(result.error).toBeUndefined();
    });

    it('includes error when status is failed', async () => {
      repo.findOneBy.mockResolvedValue({
        id: 'job_123',
        status: 'failed',
        error: 'CloudConvert conversion failed',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ConversionJob);

      const result = await service.getStatus('job_123');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('CloudConvert conversion failed');
      expect(result.downloadUrl).toBeUndefined();
    });

    it('returns bare status for in_progress (no downloadUrl/error)', async () => {
      repo.findOneBy.mockResolvedValue({
        id: 'job_123',
        status: 'in_progress',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ConversionJob);

      const result = await service.getStatus('job_123');

      expect(result.status).toBe('in_progress');
      expect(result.downloadUrl).toBeUndefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe('getResult', () => {
    it('returns "not ready" message when not done', async () => {
      repo.findOneBy.mockResolvedValue({
        id: 'job_123',
        status: 'in_progress',
      } as ConversionJob);

      const result = await service.getResult('job_123');

      expect(result.message).toBe('File is not ready yet');
    });

    it('returns downloadUrl when done', async () => {
      repo.findOneBy.mockResolvedValue({
        id: 'job_123',
        status: 'done',
        resultFileUrl: 'https://cloudconvert.com/result.pdf',
      } as ConversionJob);

      const result = await service.getResult('job_123');

      expect(result.status).toBe('done');
      expect(result.downloadUrl).toBe('https://cloudconvert.com/result.pdf');
    });
  });

  describe('cancel', () => {
    it('refuses to cancel an already-done job', async () => {
      repo.findOneBy.mockResolvedValue({
        id: 'job_123',
        status: 'done',
      } as ConversionJob);

      const result = await service.cancel('job_123');

      expect(result.message).toBe('Job already done');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('cancels a pending job by marking it failed', async () => {
      repo.findOneBy.mockResolvedValue({
        id: 'job_123',
        status: 'pending',
      } as ConversionJob);

      const result = await service.cancel('job_123');

      expect(result.status).toBe('failed');
      expect(result.message).toBe('Job cancelled');
      expect(repo.save).toHaveBeenCalled();
    });
  });
});
