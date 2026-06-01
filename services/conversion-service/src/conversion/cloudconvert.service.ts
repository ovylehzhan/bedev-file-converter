import { Injectable, Logger } from '@nestjs/common';
import CloudConvert from 'cloudconvert';
import * as fs from 'fs';

/**
 * Wrapper around CloudConvert API.
 *
 * CloudConvert job consists of 3 tasks:
 *   1. import/upload — upload our source file
 *   2. convert       — convert from sourceFormat to targetFormat
 *   3. export/url    — get a download URL for the result
 *
 * Sandbox mode (CLOUDCONVERT_SANDBOX=true) uses test API
 * that doesn't consume real credits.
 */
@Injectable()
export class CloudConvertService {
  private readonly logger = new Logger(CloudConvertService.name);
  private client: CloudConvert;

  constructor() {
    this.client = new CloudConvert(process.env.CLOUDCONVERT_API_KEY || '', {
      sandbox: process.env.CLOUDCONVERT_SANDBOX === 'true',
    });
  }

  async convert(
    inputFilePath: string,
    sourceFormat: string,
    targetFormat: string,
  ): Promise<{ resultUrl: string; cloudConvertJobId: string }> {
    this.logger.log(
      `Starting conversion: ${sourceFormat} → ${targetFormat}`,
    );

    // Step 1: Create a job with 3 tasks (pipeline)
    const job = await this.client.jobs.create({
      tasks: {
        'upload-file': {
          operation: 'import/upload',
        },
        'convert-file': {
          operation: 'convert',
          input: ['upload-file'],
          input_format: sourceFormat,
          output_format: targetFormat,
        },
        'export-file': {
          operation: 'export/url',
          input: ['convert-file'],
        },
      },
    });

    this.logger.log(`CloudConvert job created: ${job.id}`);

    // Step 2: Upload our file to the import task
    const uploadTask = job.tasks.find((t) => t.name === 'upload-file');
    if (!uploadTask) {
      throw new Error('Upload task not found in CloudConvert job');
    }

    const inputFile = fs.createReadStream(inputFilePath);
    await this.client.tasks.upload(uploadTask, inputFile);
    this.logger.log('File uploaded to CloudConvert');

    // Step 3: Wait for job to complete (polling internally)
    const completed = await this.client.jobs.wait(job.id);
    this.logger.log(`CloudConvert job completed: ${completed.status}`);

    // Step 4: Extract result URL from export task
    const exportTask = completed.tasks.find((t) => t.name === 'export-file');
    if (!exportTask?.result?.files?.[0]?.url) {
      throw new Error('No result file URL from CloudConvert');
    }

    return {
      resultUrl: exportTask.result.files[0].url,
      cloudConvertJobId: job.id,
    };
  }
}
