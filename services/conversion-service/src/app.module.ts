import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConversionModule } from './conversion/conversion.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    // Same PostgreSQL database as api-gateway (shared state)
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
