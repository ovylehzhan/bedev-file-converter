import {
  Controller,
  Get,
  ServiceUnavailableException,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';

/**
 * Health check that verifies real dependencies (not just "HTTP is up"):
 *   - PostgreSQL (job state) → SELECT 1
 *   - Redis (queue + PubSub) → PING/PONG
 * Returns 503 if either is down → Docker restarts the container.
 */
@Controller('health')
export class HealthController implements OnModuleDestroy {
  private readonly redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: 1,
  });

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get()
  async check() {
    const dbOk = await this.dataSource
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);

    const redisOk = await this.redis
      .ping()
      .then((r) => r === 'PONG')
      .catch(() => false);

    const body = {
      service: 'api-gateway',
      db: dbOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
    };

    if (!dbOk || !redisOk) {
      throw new ServiceUnavailableException({ status: 'error', ...body });
    }
    return { status: 'ok', ...body };
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
