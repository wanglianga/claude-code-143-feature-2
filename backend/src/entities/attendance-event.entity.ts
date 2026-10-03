import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type AttendanceKind = 'CHECK_IN' | 'CHECK_OUT';

// 四重校验要素：定位 / 人脸 / 现场主管确认 / 签到二维码
export interface CheckFactors {
  location: boolean; // 定位在围栏内
  face: boolean; // 人脸比对通过（演示为头像样本核验）
  supervisor: boolean; // 现场主管确认
  qrcode: boolean; // 扫描岗位动态二维码
}

@Entity('attendance_events')
@Index(['assignmentId'])
export class AttendanceEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  assignmentId: number;

  @Column()
  jobId: number;

  @Column()
  workerId: number;

  @Column({ type: 'varchar', length: 16 })
  kind: AttendanceKind;

  // 四重校验结果
  @Column({ type: 'boolean', default: false })
  locationPassed: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  lat: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  lng: number | null;

  @Column({ type: 'int', nullable: true })
  distanceMeters: number | null;

  @Column({ type: 'boolean', default: false })
  facePassed: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  faceScore: number | null;

  @Column({ type: 'boolean', default: false })
  supervisorConfirmed: boolean;

  @Column({ type: 'int', nullable: true })
  confirmedBySupervisorId: number | null;

  @Column({ type: 'datetime', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  qrcodePassed: boolean;

  @Column({ length: 64, nullable: true })
  qrcodeToken: string | null;

  // 高风险企业岗位：双人确认
  @Column({ type: 'boolean', default: false })
  secondConfirmed: boolean;

  @Column({ type: 'int', nullable: true })
  secondConfirmedBy: number | null;

  // 是否四重全部通过
  @Column({ type: 'boolean', default: false })
  allPassed: boolean;

  // 平台事后追查认定的实际到岗（用于工资/责任认定）；保险生效时间不因此追溯，禁止事后补录保险
  @Column({ type: 'boolean', default: false })
  retroRecognized: boolean;

  @Column({ length: 255, nullable: true })
  failReason: string | null;

  // 现场照片（演示用：dataURL 或占位 URL）
  @Column({ type: 'text', nullable: true })
  photoUrl: string | null;

  @Column({ type: 'datetime' })
  eventTime: Date;

  @CreateDateColumn()
  createdAt: Date;
}
