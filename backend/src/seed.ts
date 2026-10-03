import { DataSource } from 'typeorm';
import { hash } from 'bcryptjs';
import { config } from './config';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, InjuryCase, InjuryCaseFollowup, ChatMessage, Settlement, Appeal, Review,
} from './entities';
import { INDUSTRIES, depositMultiplier, strictConfirmationRequired } from './risk.constants';

let ds: DataSource | null = null;

async function dataSource(): Promise<DataSource> {
  if (ds) return ds;
  ds = new DataSource({
    type: 'mysql',
    host: config.db.host,
    port: config.db.port,
    username: config.db.username,
    password: config.db.password,
    database: config.db.database,
    entities: [
      User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
      JobEvent, InjuryClaim, InjuryCase, InjuryCaseFollowup, ChatMessage, Settlement, Appeal, Review,
    ],
    charset: 'utf8mb4',
    timezone: '+08:00',
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

export async function runSeed() {
  const source = await dataSource();
  const users = source.getRepository(User);
  const enterprises = source.getRepository(Enterprise);
  const jobs = source.getRepository(Job);

  if (await users.findOne({ where: { username: 'worker1' } })) {
    // 幂等：种子账号已存在则跳过
    return;
  }

  const pwd = await hash('123456', 10);

  // ---------- 工人 ----------
  const worker1 = await users.save(users.create({
    username: 'worker1', passwordHash: pwd, name: '张三', phone: '13800000001', role: 'WORKER',
    idCardNo: '310101199003071234', idVerifiedAt: new Date(),
    healthCertUntil: '2027-12-31', faceSampleUrl: 'seed://face-zhangsan',
  }));
  await users.save(users.create({
    username: 'worker2', passwordHash: pwd, name: '李四', phone: '13800000002', role: 'WORKER',
    // 未实名、无健康证、无人脸样本 —— 用于演示报名门禁与考勤拦截
  }));
  void worker1;

  // ---------- 正常企业 ----------
  const ent1User = await users.save(users.create({
    username: 'enterprise1', passwordHash: pwd, name: '刘经理', phone: '13900000001', role: 'ENTERPRISE',
  }));
  const ent1 = await enterprises.save(enterprises.create({
    name: '安心会展服务有限公司', contactPhone: '13900000001', accountUserId: ent1User.id,
    riskLevel: 1, totalJobs: 0, depositBalance: 20000, depositFrozen: 0,
  }));
  ent1User.enterpriseId = ent1.id;
  await users.save(ent1User);

  await users.save(users.create({
    username: 'supervisor1', passwordHash: pwd, name: '王主管', phone: '13700000001',
    role: 'SUPERVISOR', enterpriseId: ent1.id, faceSampleUrl: 'seed://face-sup1',
  }));
  await users.save(users.create({
    username: 'supervisor1b', passwordHash: pwd, name: '赵场务', phone: '13700000002',
    role: 'SUPERVISOR', enterpriseId: ent1.id,
  }));

  // ---------- 高风险企业（高取消率 + 高有责争议率 → 风险等级 5） ----------
  const riskyUser = await users.save(users.create({
    username: 'enterprise_risky', passwordHash: pwd, name: '钱总', phone: '13900000002', role: 'ENTERPRISE',
  }));
  const risky = await enterprises.save(enterprises.create({
    name: '雷霆突击人力资源公司', contactPhone: '13900000002', accountUserId: riskyUser.id,
    riskLevel: 5, totalJobs: 10, cancelledJobs: 2, disputedAssignments: 4, lostDisputes: 3,
    injuryJobs: 1,
    cancelRate: 0.2, disputeRate: 0.3, injuryRate: 0.1,
    depositBalance: 50000, depositFrozen: 0,
  }));
  riskyUser.enterpriseId = risky.id;
  await users.save(riskyUser);
  await users.save(users.create({
    username: 'supervisor_risky', passwordHash: pwd, name: '孙队', phone: '13700000003',
    role: 'SUPERVISOR', enterpriseId: risky.id,
  }));
  await users.save(users.create({
    username: 'supervisor_riskyb', passwordHash: pwd, name: '李队', phone: '13700000004',
    role: 'SUPERVISOR', enterpriseId: risky.id,
  }));

  // ---------- 客服 / 仲裁员 ----------
  await users.save(users.create({
    username: 'support', passwordHash: pwd, name: '平台客服', phone: '13600000000', role: 'SUPPORT',
  }));

  // ---------- 岗位 ----------
  const now = Date.now();
  const iso = (offsetMin: number) => new Date(now + offsetMin * 60000);
  const mk = (enterprise: Enterprise, opt: Partial<Job> & { title: string; industry: any }): Job => {
    const industry = INDUSTRIES[opt.industry as keyof typeof INDUSTRIES];
    const deposit = Math.round(
      industry.baseDeposit * depositMultiplier(enterprise.riskLevel) * (opt.headcount || 1),
    );
    return jobs.create({
      enterpriseId: enterprise.id,
      description: opt.description || '按现场安排完成工作，服从主管调度。',
      location: opt.location || '上海市浦东新区世博展览馆 H2 馆',
      lat: 31.2304, lng: 121.4737,
      startTime: iso(-10), endTime: iso(300),
      headcount: 1,
      skillRequirement: '无特殊要求',
      requireHealthCert: industry.healthCertRequired,
      dressCode: null,
      dailyWage: 260, overtimeRate: 30, mealAllowance: 20,
      lateDeductPerMin: 2, lateGraceMinutes: 5,
      insuranceCoverageWan: 30,
      insurancePremium: Math.round(260 * industry.insuranceRate * 100) / 100,
      settlementMethod: '日结-完工24小时内',
      platformFeeRate: 0.08,
      status: 'OPEN',
      depositRequired: deposit, depositPaid: true,
      strictConfirmation: strictConfirmationRequired(enterprise.riskLevel),
      prepayment: 0,
      ...opt,
    } as Job);
  };

  const job1 = mk(ent1, {
    title: '世博动漫展·展台搭建帮工', industry: 'EXHIBITION',
    description: '协助桁架搭建、展柜搬运，需穿劳保鞋；有轻微登高作业。',
    skillRequirement: '体力好，有会展搭建经验优先', dressCode: '劳保鞋+手套',
    location: '上海市浦东新区世博展览馆 H2 馆',
    dailyWage: 300, overtimeRate: 35, mealAllowance: 25,
    startTime: iso(-10), endTime: iso(360), headcount: 3,
  });
  const job2 = mk(ent1, {
    title: '盒马鲜生·夜班仓库分拣', industry: 'WAREHOUSE',
    location: '上海市嘉定区丰茂路物流园 3 号库',
    description: '生鲜分拣、码拍、笼车搬运。',
    dailyWage: 240, startTime: iso(60 * 20), endTime: iso(60 * 28), headcount: 5,
  });
  const job3 = mk(ent1, {
    title: '星级酒店宴会厅·餐饮帮工', industry: 'CATERING',
    location: '上海市静安区南京西路 1266 号',
    description: '传菜、摆台、收尾清洗。必须持有效健康证。',
    dailyWage: 220, mealAllowance: 30, requireHealthCert: true,
    dressCode: '黑裤黑鞋，酒店提供工服',
    startTime: iso(60 * 26), endTime: iso(60 * 32), headcount: 4,
  });
  const job4 = mk(risky, {
    title: '大型音乐节·入口安检安保', industry: 'SECURITY',
    location: '上海市徐汇区滨江音乐公园',
    description: '入口安检、秩序维护、突发情况处置（高风险岗位，需双人现场确认）。',
    skillRequirement: '身高175+，有安保经验优先', dressCode: '黑色安保制服',
    dailyWage: 320, overtimeRate: 40, mealAllowance: 20, insuranceCoverageWan: 50,
    startTime: iso(60 * 2), endTime: iso(60 * 10), headcount: 2,
  });
  const job5 = mk(risky, {
    title: '写字楼年终保洁突击', industry: 'CLEANING',
    location: '上海市黄浦区人民广场写字楼',
    dailyWage: 210, startTime: iso(60 * 44), endTime: iso(60 * 52), headcount: 6,
  });
  const job6 = mk(ent1, {
    title: '连锁超市月度盘点', industry: 'INVENTORY',
    location: '上海市杨浦区五角场万达',
    dailyWage: 180, startTime: iso(60 * 50), endTime: iso(60 * 56), headcount: 4,
  });
  const created = await jobs.save([job1, job2, job3, job4, job5, job6]);

  // 冻结对应保证金
  for (const j of created) {
    const ent = j.enterpriseId === ent1.id ? ent1 : risky;
    ent.depositFrozen = Number(ent.depositFrozen) + Number(j.depositRequired);
    ent.depositBalance = Number(ent.depositBalance) - Number(j.depositRequired);
  }
  await enterprises.save([ent1, risky]);

  // 给主演示岗位一笔预付款
  const demo = created[0];
  demo.prepayment = 300;
  await jobs.save(demo);

  // ---------- 工伤演示数据（会展搭建扭伤脚踝） ----------
  const assignments = source.getRepository(Assignment);
  const attendanceRepo = source.getRepository(AttendanceEvent);
  const policies = source.getRepository(InsurancePolicy);
  const jobEvents = source.getRepository(JobEvent);
  const claimsRepo = source.getRepository(InjuryClaim);
  const casesRepo = source.getRepository(InjuryCase);
  const followRepo = source.getRepository(InjuryCaseFollowup);
  const settlementsRepo = source.getRepository(Settlement);
  const sup1User = await users.findOne({ where: { username: 'supervisor1' } });

  // 场景一：worker1 昨日会展撤展搬运扭伤脚踝——工资已按已完成工时结清，保险报案后理赔资料持续跟进
  const injuryJob = jobs.create({
    enterpriseId: ent1.id,
    title: '国际汽车展·展台撤展搬运（工伤演示）', industry: 'EXHIBITION',
    description: '撤展期间桁架、展柜搬运，地面有线缆绊倒风险。',
    location: '上海市青浦区国家会展中心 4.1 馆',
    lat: 31.1923, lng: 121.2963,
    startTime: new Date(now - 56 * 3600000), endTime: new Date(now - 48 * 3600000),
    headcount: 2,
    skillRequirement: '体力好，有会展搭建经验优先', dressCode: '劳保鞋+手套',
    requireHealthCert: false,
    dailyWage: 320, overtimeRate: 40, mealAllowance: 25,
    lateDeductPerMin: 2, lateGraceMinutes: 5,
    insuranceCoverageWan: 30, insurancePremium: Math.round(320 * INDUSTRIES.EXHIBITION.insuranceRate * 100) / 100,
    settlementMethod: '日结-完工24小时内', platformFeeRate: 0.08,
    status: 'COMPLETED', depositRequired: 300, depositPaid: true,
    strictConfirmation: false, prepayment: 0,
  });
  await jobs.save(injuryJob);
  // 岗位已完工，保证金不再冻结（冻结→释放的净额为 0）
  void ent1;

  const injAssignment = await assignments.save(assignments.create({
    jobId: injuryJob.id, workerId: worker1.id, status: 'COMPLETED',
    riskAcknowledged: true, appliedAt: new Date(now - 57 * 3600000),
    acceptedAt: new Date(now - 56 * 3600000), ratingSnapshot: 5, completedJobsCount: 0,
  }));

  const checkinTime = new Date(now - 56 * 3600000 + 12 * 60000); // 开工后12分钟签到
  const injuryTime = new Date(now - 52 * 3600000); // 已工作约4小时
  await attendanceRepo.save(attendanceRepo.create({
    assignmentId: injAssignment.id, jobId: injuryJob.id, workerId: worker1.id,
    kind: 'CHECK_IN', locationPassed: true, lat: 31.1923, lng: 121.2963, distanceMeters: 35,
    facePassed: true, faceScore: 94, supervisorConfirmed: true,
    confirmedBySupervisorId: sup1User!.id, confirmedAt: checkinTime,
    qrcodePassed: true, qrcodeToken: 'SEED0001', secondConfirmed: false, allPassed: true,
    failReason: null, photoUrl: 'seed://injury-checkin', eventTime: checkinTime,
  }));

  const injPolicy = await policies.save(policies.create({
    assignmentId: injAssignment.id, jobId: injuryJob.id, workerId: worker1.id, enterpriseId: ent1.id,
    insurerProduct: '高危作业人员意外险·搭建专项', coverageWan: 30,
    premium: injuryJob.insurancePremium, status: 'EXPIRED',
    effectiveFrom: checkinTime, effectiveTo: injuryTime, jobRiskLevel: 4, enterpriseConfirmed: true,
  }));

  const injEvent = await jobEvents.save(jobEvents.create({
    assignmentId: injAssignment.id, jobId: injuryJob.id, workerId: worker1.id,
    type: 'INJURY', description: '搬运桁架时踩到地面线缆绊倒，扭伤右脚踝，肿胀无法承重',
    occurredAt: injuryTime, photoUrl: 'seed://ankle-scene-1', lat: 31.1923, lng: 121.2963,
    status: 'APPROVED', reviewedBy: sup1User!.id, reviewedAt: new Date(now - 52 * 3600000 + 5 * 60000),
    reviewNote: '现场目击，地面线缆未做防护，立即陪同就医',
  }));

  // 日结工资先按事故前已完成工时（约 228/480 分钟）结算并已发放——工资结清不影响理赔继续跟进
  const workMinutes = 228;
  const baseWage = Math.round((320 * workMinutes) / 480 * 100) / 100; // 152
  const platformFee = Math.round(baseWage * 0.08 * 100) / 100;
  await settlementsRepo.save(settlementsRepo.create({
    assignmentId: injAssignment.id, jobId: injuryJob.id, workerId: worker1.id, enterpriseId: ent1.id,
    workMinutes, overtimeMinutes: 0, lateMinutes: 0,
    baseWage, overtimePay: 0, extraCarryPay: 0, mealAllowance: 25,
    lateDeduction: 0, otherDeduction: 0,
    deductionReason: `工伤停工：按事故前已完成工时 ${workMinutes} 分钟折算（医疗垫付与责任另案跟进）`,
    insurancePremium: injuryJob.insurancePremium, platformServiceFee: platformFee,
    enterprisePrepaymentUsed: 0, workerPayable: baseWage + 25,
    enterpriseCharged: baseWage + 25 + Number(injuryJob.insurancePremium) + platformFee,
    status: 'PAID', paidAt: new Date(now - 51 * 3600000),
  }));

  const injClaim = await claimsRepo.save(claimsRepo.create({
    assignmentId: injAssignment.id, jobId: injuryJob.id, workerId: worker1.id, enterpriseId: ent1.id,
    jobEventId: injEvent.id, insurancePolicyId: injPolicy.id,
    injuryDesc: '右脚踝扭伤（韧带损伤）', claimAmount: 3200,
    status: 'WAITING_DOCS', coveredAtOccurrence: true,
    adjusterNote: '事故发生于保险保障期内，已报案；等待医院补充正式发票与企业责任意见',
    insurerReportNo: 'BXDEMO-SEED-ANKLE',
    reportedAt: new Date(now - 51 * 3600000), reportedBy: null,
    materials: {
      accidentNotice: true, medicalRecord: true, receipts: false, attendanceProof: true,
      supervisorStatement: true, enterpriseOpinion: false, idCopy: true,
    },
    hospitalReceiptStatus: 'PENDING',
    hospitalReceiptNote: '第六人民医院初诊票据为缴费凭条，正式发票待七个工作日后补开',
    enterpriseOpinionSubmitted: false, attendanceGapFlag: false,
    lastFollowupAt: new Date(now - 50 * 3600000),
  }));

  const injCase = await casesRepo.save(casesRepo.create({
    assignmentId: injAssignment.id, jobId: injuryJob.id, workerId: worker1.id, enterpriseId: ent1.id,
    jobEventId: injEvent.id, injuryClaimId: injClaim.id, status: 'CLAIM_TRACKING',
    occurredAt: injuryTime, positionAtInjury: '展台搭建搬运工',
    injuryDesc: '搬运桁架时踩到地面线缆绊倒，扭伤右脚踝，肿胀无法承重',
    scenePhotos: 'seed://ankle-scene-1,seed://ankle-scene-2',
    hospital: '上海市第六人民医院', medicalReceipts: 'seed://receipt-clinic,seed://receipt-xray',
    medicalExpense: 860,
    supervisorConfirmed: true, confirmedBySupervisorId: sup1User!.id,
    confirmedAt: new Date(now - 52 * 3600000 + 5 * 60000),
    supervisorNote: '现场目击，地面线缆未做防护，立即陪同就医',
    insurancePolicyId: injPolicy.id, coveredAtOccurrence: true, policyStatusAtOccurrence: 'ACTIVE',
    insurerReportNo: injClaim.insurerReportNo, reportedAt: new Date(now - 51 * 3600000),
    reportNote: '材料初核：事故说明、病历、考勤、主管说明已收，待医院正式发票',
    attendanceGap: false, attendanceGapResult: 'CONFIRMED_ARRIVAL',
    advanceSource: 'ENTERPRISE', advanceAmount: 800, advanceRecoveryStatus: 'PENDING',
    advanceNote: '企业现场垫付急诊与检查费用，待理赔到账后抵扣',
    liability: 'PENDING', enterpriseLiabilityPct: 0,
  }));

  const mkFollow = async (
    type: InjuryCaseFollowup['type'],
    content: string,
    role: InjuryCaseFollowup['actorRole'],
    actorName: string,
    hAgo: number,
    attachments?: string,
    amount?: number,
  ) => {
    const f = await followRepo.save(followRepo.create({
      caseId: injCase.id, type, content, attachments: attachments || null,
      amount: amount ?? null, actorName, actorRole: role,
    }));
    // 覆盖 createdAt 以呈现真实跟进时间线（演示数据）
    f.createdAt = new Date(now - hAgo * 3600000);
    return followRepo.save(f);
  };
  await mkFollow('STATUS', '工人现场记录工伤事件：搬运桁架时踩到地面线缆绊倒，扭伤右脚踝；岗位：展台搭建搬运工；就医医院：上海市第六人民医院', 'WORKER', '张三', 52);
  await mkFollow('SUPERVISOR_NOTE', '现场主管确认工伤属实：地面线缆未做防护，立即陪同就医', 'SUPERVISOR', '王主管', 52);
  await mkFollow('INSURER', `客服发起保险报案，报案号 ${injClaim.insurerReportNo}；保险在保障期内，立案跟进理赔资料`, 'SUPPORT', '平台客服', 51);
  await mkFollow('ADVANCE', '登记医疗垫付 ¥800.00（来源：企业垫付）；垫付与日结工资分开记账，理赔结案时再行抵扣/追回', 'ENTERPRISE', '刘经理', 51, undefined, 800);
  await mkFollow('DOC_REQUIRED', '理赔资料清单更新：医疗票据✗待补、企业责任意见✗待补；医院正式发票七个工作日后补开', 'SUPPORT', '平台客服', 50);

  // 场景二：企业录取后未按要求确认到岗，工人作业中扭伤——考勤缺失待平台追查
  const worker3 = await users.save(users.create({
    username: 'worker3', passwordHash: pwd, name: '王五', phone: '13800000003', role: 'WORKER',
    idCardNo: '310101199205053333', idVerifiedAt: new Date(),
    healthCertUntil: '2027-12-31', faceSampleUrl: 'seed://face-wangwu',
  }));
  const gapJob = await jobs.save(jobs.create({
    enterpriseId: ent1.id,
    title: '家电卖场·展台搭建（考勤缺失工伤演示）', industry: 'EXHIBITION',
    description: '展台木结构搭建与灯箱搬运。',
    location: '上海市普陀区环球港中庭',
    lat: 31.2397, lng: 121.4071,
    startTime: new Date(now - 2 * 3600000), endTime: new Date(now + 4 * 3600000),
    headcount: 1,
    skillRequirement: '无特殊要求', requireHealthCert: false,
    dailyWage: 280, overtimeRate: 35, mealAllowance: 20,
    lateDeductPerMin: 2, lateGraceMinutes: 5,
    insuranceCoverageWan: 30, insurancePremium: Math.round(280 * INDUSTRIES.EXHIBITION.insuranceRate * 100) / 100,
    settlementMethod: '日结-完工24小时内', platformFeeRate: 0.08,
    status: 'IN_PROGRESS', depositRequired: 300, depositPaid: true,
    strictConfirmation: false, prepayment: 0,
  }));
  ent1.depositFrozen = Number(ent1.depositFrozen) + 300;
  ent1.depositBalance = Number(ent1.depositBalance) - 300;
  await enterprises.save(ent1);

  const gapAssignment = await assignments.save(assignments.create({
    jobId: gapJob.id, workerId: worker3.id, status: 'ACCEPTED',
    riskAcknowledged: true, appliedAt: new Date(now - 3 * 3600000),
    acceptedAt: new Date(now - 2.5 * 3600000), ratingSnapshot: 5, completedJobsCount: 0,
  }));
  await policies.save(policies.create({
    assignmentId: gapAssignment.id, jobId: gapJob.id, workerId: worker3.id, enterpriseId: ent1.id,
    insurerProduct: '高危作业人员意外险·搭建专项', coverageWan: 30,
    premium: gapJob.insurancePremium, status: 'PENDING', jobRiskLevel: 4, enterpriseConfirmed: true,
  }));
  const gapEvent = await jobEvents.save(jobEvents.create({
    assignmentId: gapAssignment.id, jobId: gapJob.id, workerId: worker3.id,
    type: 'INJURY', description: '抬灯箱时滑倒扭伤左脚踝（企业未在系统确认到岗）',
    occurredAt: new Date(now - 40 * 60000), photoUrl: 'seed://gap-scene',
    lat: 31.2397, lng: 121.4071, status: 'APPROVED',
    reviewedBy: sup1User!.id, reviewedAt: new Date(now - 35 * 60000),
    reviewNote: '我在现场看到他抬灯箱滑倒，早上确实到岗了，当时忙没在系统点确认',
  }));
  await casesRepo.save(casesRepo.create({
    assignmentId: gapAssignment.id, jobId: gapJob.id, workerId: worker3.id, enterpriseId: ent1.id,
    jobEventId: gapEvent.id, status: 'CONFIRMED',
    occurredAt: new Date(now - 40 * 60000), positionAtInjury: '展台搭建灯箱搬运',
    injuryDesc: '抬灯箱时滑倒扭伤左脚踝（企业未在系统确认到岗）',
    scenePhotos: 'seed://gap-scene', hospital: '上海市普陀区中心医院',
    medicalReceipts: 'seed://gap-receipt', medicalExpense: 520,
    supervisorConfirmed: true, confirmedBySupervisorId: sup1User!.id,
    confirmedAt: new Date(now - 35 * 60000),
    supervisorNote: '我在现场看到他抬灯箱滑倒，早上确实到岗了，当时忙没在系统点确认',
    insurancePolicyId: null, coveredAtOccurrence: false, policyStatusAtOccurrence: 'PENDING',
    attendanceGap: true, attendanceGapResult: 'PENDING',
    advanceSource: 'NONE', advanceRecoveryStatus: 'N_A',
    liability: 'PENDING', enterpriseLiabilityPct: 0,
  }));

  console.log('[seed] 种子数据完成：worker1/worker2/worker3/enterprise1/supervisor1/enterprise_risky/support，密码均为 123456');
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
