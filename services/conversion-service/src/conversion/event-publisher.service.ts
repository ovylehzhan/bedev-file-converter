import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Publishes job events to Redis PubSub channel "job-events".
 *
 * This is the "Event Bus" from the CTO's architecture diagram (step 13).
 * Consumers: API Gateway (SSE Service), Notification Service.
 */
@Injectable()
export class EventPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(EventPublisherService.name);
  private publisher: Redis;

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
    const message = JSON.stringify(event);
    await this.publisher.publish('job-events', message);
    this.logger.log(`Published event: ${event.jobId} → ${event.status}`);
  }

  onModuleDestroy() {
    this.publisher.disconnect();
  }
}
