import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import Redis from 'ioredis';

/**
 * SSE Service — bridges Redis PubSub events to Server-Sent Events.
 *
 * Flow (from CTO's architecture diagram):
 *   Conversion Service → publishes to Redis "job-events" channel
 *   SSE Service → subscribes to Redis → filters by jobId → SSE stream to client
 *
 * Why Redis PubSub? From CTO's experiment:
 *   SSE latency ~10ms vs Short Polling ~5000ms (500x better)
 */
interface JobEvent {
  jobId: string;
  status: string;
  downloadUrl?: string;
  error?: string;
}

@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly logger = new Logger(SseService.name);
  private subscriber: Redis;
  private events$ = new Subject<JobEvent>();

  constructor() {
    this.subscriber = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    // Subscribe to the "job-events" channel (our Event Bus)
    this.subscriber.subscribe('job-events', (err) => {
      if (err) {
        this.logger.error('Redis subscribe error:', err);
      } else {
        this.logger.log('Subscribed to job-events channel');
      }
    });

    // When a message arrives on Redis PubSub → push it into RxJS Subject
    this.subscriber.on('message', (_channel, message) => {
      try {
        const event: JobEvent = JSON.parse(message);
        this.events$.next(event);
      } catch (e) {
        this.logger.error('Failed to parse job event:', e);
      }
    });
  }

  /**
   * Returns an Observable that emits SSE events for a specific jobId.
   * NestJS @Sse() decorator streams this Observable to the client.
   *
   * Event types match the Notion spec:
   *   "status"    — job is in_progress
   *   "completed" — job is done, includes downloadUrl
   *   "failed"    — job failed, includes error message
   */
  getJobEvents(jobId: string): Observable<MessageEvent> {
    return this.events$.pipe(
      // Only emit events for THIS job
      filter((event) => event.jobId === jobId),
      // Transform to SSE format expected by NestJS
      map((event) => {
        const eventType =
          event.status === 'done'
            ? 'completed'
            : event.status === 'failed'
              ? 'failed'
              : 'status';

        return {
          data: JSON.stringify(event),
          type: eventType,
        } as MessageEvent;
      }),
    );
  }

  onModuleDestroy() {
    this.subscriber.disconnect();
  }
}
