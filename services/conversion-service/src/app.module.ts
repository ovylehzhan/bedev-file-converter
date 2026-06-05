import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConversionModule } from './conversion/conversion.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    // Same PostgreSQL database as api-gateway (shared state).
    // This service is the single SCHEMA OWNER: synchronize runs here only,
    // so the two services don't race to create the same tables. api-gateway
    // runs with synchronize: false and waits for this service to be healthy.
    // (Production: synchronize: false + explicit migration files instead.)
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true,
    }),

    // Same Redis as api-gateway (shared queue)
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),

    ConversionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
