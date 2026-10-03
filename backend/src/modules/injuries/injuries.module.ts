import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, InjuryCase, InjuryCaseFollowup, Settlement,
} from '../../entities';
import { InjuryCasesService } from './injuries.service';
import { InjuriesController } from './injuries.controller';
import { SettlementModule } from '../settlements/settlement.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
      JobEvent, InjuryClaim, InjuryCase, InjuryCaseFollowup, Settlement,
    ]),
    SettlementModule,
  ],
  providers: [InjuryCasesService],
  controllers: [InjuriesController],
  exports: [InjuryCasesService],
})
export class InjuriesModule {}
