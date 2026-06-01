import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { NotificationListener } from './notification.listener';

/**
 * Mock ioredis so onModuleInit doesn't open a real connection.
 * Capture the "message" handler to simulate incoming events.
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

describe('NotificationListener', () => {
  let listener: NotificationListener;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationListener],
    }).compile();

    listener = module.get(NotificationListener);
    listener.onModuleInit(); // sets up subscription + captures handler
  });

  function emit(event: object) {
    messageHandler('job-events', JSON.stringify(event));
  }

  it('logs an info message when a job completes', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    emit({ jobId: 'job_1', status: 'done', downloadUrl: 'http://x' });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('job_1'),
    );
  });

  it('logs a warning when a job fails', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    emit({ jobId: 'job_2', status: 'failed', error: 'boom' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('boom'),
    );
  });

  it('does not throw on malformed JSON', () => {
    expect(() => messageHandler('job-events', 'not-json{')).not.toThrow();
  });
});
