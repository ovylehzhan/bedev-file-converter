import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Subscribes to Redis PubSub channel "job-events" (step 14 from diagram).
 *
 * In this MVP: logs all events for observability.
 * In production this would be extended with:
 *   - Email notifications (job done → send email to user)
 *   - Webhook delivery (POST to user's callback URL)
 *   - Slack/Telegram notifications
 *   - Event persistence (store event history for audit)
 */
@Injectable()
export class NotificationListener implements OnModuleInit, OnModuleDestroy {
  private subscriber: Redis;
  private readonly logger = new Logger(NotificationListener.name);

  onModuleInit() {
    this.subscriber = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    this.subscriber.subscribe('job-events', (err) => {
      if (err) {
        this.logger.error('Failed to subscribe to job-events', err);
      } else {
        this.logger.log('Subscribed to job-events channel');
      }
    });

    this.subscriber.on('message', (_channel, message) => {
      try {
        const event = JSON.parse(message);
        this.handleEvent(event);
      } catch (e) {
        this.logger.error('Failed to parse event:', e);
      }
    });
  }

  /**
   * Handle incoming job event.
   * Currently logs; extend with notification delivery logic.
   */
  private handleEvent(event: {
    jobId: string;
    status: string;
    downloadUrl?: string;
    error?: string;
  }) {
    switch (event.status) {
      case 'in_progress':
        this.logger.log(`Job ${event.jobId}: conversion started`);
        break;
      case 'done':
        this.logger.log(
          `Job ${event.jobId}: completed! Download: ${event.downloadUrl}`,
        );
        // TODO: Send email notification to user
        // TODO: Call webhook if configured
        break;
      case 'failed':
        this.logger.warn(
          `Job ${event.jobId}: FAILED — ${event.error}`,
        );
        // TODO: Send failure notification
        // TODO: Trigger retry logic if applicable
        break;
      default:
        this.logger.log(
          `Job ${event.jobId}: status → ${event.status}`,
        );
    }
  }

  onModuleDestroy() {
    this.subscriber?.disconnect();
  }
}
