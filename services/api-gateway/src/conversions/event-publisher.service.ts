import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Publishes job events to the Redis "job-events" channel.
 *
 * Most events come from conversion-service. The exception is **cancel**:
 * it happens here in the API Gateway, so the Gateway must publish the
 * `failed` event itself — otherwise SSE clients connected at cancel time
 * wouldn't get the status change in real time (they'd only see it on a
 * status poll or SSE reconnect snapshot).
 */
@Injectable()
export class EventPublisherService implements OnModuleDestroy {
  private readonly publisher: Redis;

  constructor() {
    this.publisher = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  async publishJobEvent(event: {
    jobId: string;
    status: string;
    downloadUrl?: string;
    error?: string;
  }) {
    await this.publisher.publish('job-events', JSON.stringify(event));
  }

  onModuleDestroy() {
    this.publisher.disconnect();
  }
}
