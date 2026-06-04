import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConversionsModule } from './conversions/conversions.module';
import { HealthController } from './health/health.controller';
import { UiController } from './ui/ui.controller';

@Module({
  imports: [
    // PostgreSQL connection — stores conversion jobs
    // synchronize: true auto-creates tables from entities (dev only!)
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true,
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
