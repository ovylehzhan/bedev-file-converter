import { Module } from '@nestjs/common';
import { NotificationListener } from './notification.listener';

@Module({
  providers: [NotificationListener],
})
export class NotificationModule {}
