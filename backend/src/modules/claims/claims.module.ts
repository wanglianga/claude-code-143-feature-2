import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  InjuryClaim, ClaimFollowUp, JobEvent, Assignment, Job, AttendanceEvent,
  InsurancePolicy, User, Enterprise, Settlement,
} from '../../entities';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { SettlementModule } from '../settlements/settlement.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InjuryClaim, ClaimFollowUp, JobEvent, Assignment, Job, AttendanceEvent,
      InsurancePolicy, User, Enterprise, Settlement,
    ]),
    SettlementModule,
  ],
  providers: [ClaimsService],
  controllers: [ClaimsController],
  exports: [ClaimsService],
})
export class ClaimsModule {}
