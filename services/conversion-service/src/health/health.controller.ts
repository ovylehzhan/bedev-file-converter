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
 * Health check that verifies the dependencies this worker actually needs,
 * not just "the HTTP server is up":
 *   - Redis  (the queue + PubSub the worker lives on)  → PING/PONG
 *   - PostgreSQL (where job state is read/written)     → SELECT 1
 *
 * Returns 503 if either is unreachable, so Docker marks the container
 * unhealthy and restarts it.
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
    const redisOk = await this.redis
      .ping()
      .then((r) => r === 'PONG')
      .catch(() => false);

    const dbOk = await this.dataSource
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);

    const body = {
      service: 'conversion-service',
      redis: redisOk ? 'up' : 'down',
      db: dbOk ? 'up' : 'down',
    };

    if (!redisOk || !dbOk) {
      throw new ServiceUnavailableException({ status: 'error', ...body });
    }
    return { status: 'ok', ...body };
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
