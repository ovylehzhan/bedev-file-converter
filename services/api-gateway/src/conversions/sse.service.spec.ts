import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { SseService } from './sse.service';
import { ConversionJob } from './conversion-job.entity';

/**
 * Mock ioredis so the SseService constructor doesn't open a real connection.
 * We capture the "message" handler to simulate incoming Redis PubSub events.
 */
let messageHandler: (channel: string, message: string) => void;

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    subscribe: jest.fn((_channel, cb) => cb && cb(null)),
    on: jest.fn((event: string, handler: any) => {
      if (event === 'message') messageHandler = handler;
    }),
    disconnect: jest.fn(),
  }));
});

describe('SseService', () => {
  let service: SseService;
  let repo: { findOneBy: jest.Mock };

  beforeEach(async () => {
    // Default: no snapshot (findOneBy → null) so existing tests see only
    // the live stream. Individual tests override findOneBy as needed.
    repo = { findOneBy: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SseService,
        { provide: getRepositoryToken(ConversionJob), useValue: repo },
      ],
    }).compile();

    service = module.get(SseService);
  });

  /** Helper: simulate a Redis PubSub message arriving */
  function emitRedisEvent(event: object) {
    messageHandler('job-events', JSON.stringify(event));
  }

  it('maps in_progress status to SSE event type "status"', async () => {
    const promise = firstValueFrom(service.getJobEvents('job_1').pipe(take(1)));

    emitRedisEvent({ jobId: 'job_1', status: 'in_progress' });

    const msg = await promise;
    expect(msg.type).toBe('status');
    expect(JSON.parse(msg.data as string)).toEqual({
      jobId: 'job_1',
      status: 'in_progress',
    });
  });

  it('maps done status to SSE event type "completed"', async () => {
    const promise = firstValueFrom(service.getJobEvents('job_1').pipe(take(1)));

    emitRedisEvent({
      jobId: 'job_1',
      status: 'done',
      downloadUrl: 'http://x/result',
    });

    const msg = await promise;
    expect(msg.type).toBe('completed');
  });

  it('maps failed status to SSE event type "failed"', async () => {
    const promise = firstValueFrom(service.getJobEvents('job_1').pipe(take(1)));

    emitRedisEvent({ jobId: 'job_1', status: 'failed', error: 'boom' });

    const msg = await promise;
    expect(msg.type).toBe('failed');
  });

  it('only delivers events for the requested jobId (filtering)', async () => {
    // Collect 1 event for job_1; we emit one for job_OTHER and one for job_1
    const promise = firstValueFrom(
      service.getJobEvents('job_1').pipe(take(1), toArray()),
    );

    emitRedisEvent({ jobId: 'job_OTHER', status: 'done' });
    emitRedisEvent({ jobId: 'job_1', status: 'in_progress' });

    const events = await promise;
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data as string).jobId).toBe('job_1');
  });

  it('emits a DB snapshot first, so a late subscriber gets the terminal state', async () => {
    // Job already finished in the DB before the client connected.
    repo.findOneBy.mockResolvedValue({
      id: 'job_done',
      status: 'done',
    });

    // No live event is emitted — the client must still learn it's done.
    const msg = await firstValueFrom(
      service.getJobEvents('job_done').pipe(take(1)),
    );

    expect(msg.type).toBe('completed');
    const data = JSON.parse(msg.data as string);
    expect(data.jobId).toBe('job_done');
    expect(data.downloadUrl).toContain('/conversions/job_done/result');
  });
});
