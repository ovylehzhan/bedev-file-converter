import {
  Controller,
  Get,
  ServiceUnavailableException,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Health check verifying the only dependency this service has:
 * Redis (it subscribes to the "job-events" PubSub channel).
 * Returns 503 if Redis is unreachable → Docker restarts the container.
 */
@Controller('health')
export class HealthController implements OnModuleDestroy {
  private readonly redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: 1,
  });

  @Get()
  async check() {
    const redisOk = await this.redis
      .ping()
      .then((r) => r === 'PONG')
      .catch(() => false);

    if (!redisOk) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'notification-service',
        redis: 'down',
      });
    }
    return { status: 'ok', service: 'notification-service', redis: 'up' };
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
