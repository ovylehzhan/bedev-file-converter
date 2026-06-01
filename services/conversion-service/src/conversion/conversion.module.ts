import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConversionProcessor } from './conversion.processor';
import { CloudConvertService } from './cloudconvert.service';
import { EventPublisherService } from './event-publisher.service';
import { ConversionJob } from './conversion-job.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversionJob]),
    // Same queue name as in api-gateway — they share Redis
    BullModule.registerQueue({ name: 'conversions' }),
  ],
  providers: [ConversionProcessor, CloudConvertService, EventPublisherService],
})
export class ConversionModule {}
