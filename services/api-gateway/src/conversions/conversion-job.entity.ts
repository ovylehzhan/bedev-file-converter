import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Possible job statuses (state machine):
 *   pending → in_progress → done
 *                         → failed
 */
export type JobStatus = 'pending' | 'in_progress' | 'done' | 'failed';

@Entity('conversion_jobs')
export class ConversionJob {
  @PrimaryColumn()
  id: string; // e.g. "job_a1b2c3d4"

  @Column()
  originalFileName: string; // e.g. "contract.docx"

  @Column()
  sourceFormat: string; // e.g. "docx"

  @Column()
  targetFormat: string; // e.g. "pdf"

  @Column({ type: 'varchar', default: 'pending' })
  status: JobStatus;

  @Column({ nullable: true })
  cloudConvertJobId: string; // CloudConvert's internal job ID

  @Column({ nullable: true })
  inputFilePath: string; // path in shared Docker volume

  @Column({ nullable: true })
  resultFileUrl: string; // download URL from CloudConvert

  @Column({ nullable: true })
  error: string; // error message if status=failed

  // Optional client-supplied key. A retry with the same key returns the
  // existing job instead of creating a duplicate (no double CloudConvert spend).
  @Index()
  @Column({ type: 'varchar', nullable: true })
  idempotencyKey: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
