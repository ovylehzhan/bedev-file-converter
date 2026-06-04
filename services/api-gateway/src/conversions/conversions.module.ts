import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { MulterModule } from '@nestjs/platform-express';
import { ConversionsController } from './conversions.controller';
import { ConversionsService } from './conversions.service';
import { SseService } from './sse.service';
import { ConversionJob } from './conversion-job.entity';
import { MAX_FILE_SIZE_BYTES } from './formats.constants';

@Module({
  imports: [
    // Register ConversionJob entity for TypeORM repository injection
    TypeOrmModule.forFeature([ConversionJob]),

    // Register the "conversions" BullMQ queue
    // Same queue name used in conversion-service (they share Redis)
    BullModule.registerQueue({ name: 'conversions' }),

    // Configure Multer for file uploads
    // Files are saved to UPLOAD_DIR (shared Docker volume)
    // fileSize limit stops oversized uploads mid-stream (see MulterExceptionFilter)
    MulterModule.register({
      dest: process.env.UPLOAD_DIR || './uploads',
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  ],
  controllers: [ConversionsController],
  providers: [ConversionsService, SseService],
})
export class ConversionsModule {}
