import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConversionsModule } from './conversions/conversions.module';
import { HealthController } from './health/health.controller';
import { UiController } from './ui/ui.controller';

@Module({
  imports: [
    // PostgreSQL connection — stores conversion jobs.
    // synchronize is FALSE here: a single DB is shared with conversion-service,
    // and only ONE service may own schema sync (otherwise both race to create
    // the same tables on boot). conversion-service is the schema owner
    // (synchronize: true there). docker-compose makes api-gateway wait until
    // conversion-service is healthy, so the table already exists.
    // (Production: synchronize: false everywhere + explicit migration files.)
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false,
    }),

    // Redis connection for BullMQ job queue
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),

    // Our business logic module
    ConversionsModule,
  ],
  controllers: [HealthController, UiController],
})
export class AppModule {}
