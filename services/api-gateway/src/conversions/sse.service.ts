import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, Subject, merge, from } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import Redis from 'ioredis';
import { ConversionJob } from './conversion-job.entity';

/**
 * SSE Service — bridges Redis PubSub events to Server-Sent Events.
 *
 * Flow (from CTO's architecture diagram):
 *   Conversion Service → publishes to Redis "job-events" channel
 *   SSE Service → subscribes to Redis → filters by jobId → SSE stream to client
 *
 * Late-subscriber fix: on connect we first emit a SNAPSHOT of the job's
 * current state from PostgreSQL, THEN the live stream. So a client that
 * reloads / connects after the job already finished still immediately
 * receives the terminal (done/failed) state — Redis PubSub itself has no
 * replay.
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
  private readonly publicUrl =
    process.env.PUBLIC_URL || 'http://localhost:3000';
  private subscriber: Redis;
  private events$ = new Subject<JobEvent>();

  constructor(
    @InjectRepository(ConversionJob)
    private readonly jobRepo: Repository<ConversionJob>,
  ) {
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
   * Returns an Observable that emits SSE events for a specific jobId:
   *   1. a snapshot of the current DB state (so late subscribers catch up)
   *   2. then the live Redis PubSub stream, filtered by jobId
   *
   * Event types match the Notion spec:
   *   "status"    — job is pending/in_progress
   *   "completed" — job is done, includes downloadUrl
   *   "failed"    — job failed, includes error message
   */
  getJobEvents(jobId: string): Observable<MessageEvent> {
    const snapshot$ = from(this.snapshot(jobId)).pipe(
      filter((event): event is JobEvent => event !== null),
      map((event) => this.toMessageEvent(event)),
    );

    const live$ = this.events$.pipe(
      filter((event) => event.jobId === jobId),
      map((event) => this.toMessageEvent(event)),
    );

    return merge(snapshot$, live$);
  }

  /** Reads the job's current state from the DB and shapes it as an event. */
  private async snapshot(jobId: string): Promise<JobEvent | null> {
    const job = await this.jobRepo.findOneBy({ id: jobId });
    if (!job) return null;

    const event: JobEvent = { jobId: job.id, status: job.status };
    if (job.status === 'done') {
      event.downloadUrl = `${this.publicUrl}/conversions/${job.id}/result`;
    }
    if (job.status === 'failed') {
      event.error = job.error;
    }
    return event;
  }

  /** Maps a job event to the SSE MessageEvent shape NestJS expects. */
  private toMessageEvent(event: JobEvent): MessageEvent {
    const type =
      event.status === 'done'
        ? 'completed'
        : event.status === 'failed'
          ? 'failed'
          : 'status';
    return { data: JSON.stringify(event), type } as MessageEvent;
  }

  onModuleDestroy() {
    this.subscriber.disconnect();
  }
}
