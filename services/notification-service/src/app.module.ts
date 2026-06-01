import { Module } from '@nestjs/common';
import { NotificationModule } from './notification/notification.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [NotificationModule],
  controllers: [HealthController],
})
export class AppModule {}
