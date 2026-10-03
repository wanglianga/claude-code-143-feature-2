import { DataSource } from 'typeorm';
import { hash } from 'bcryptjs';
import { config } from './config';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, ClaimFollowUp, ChatMessage, Settlement, Appeal, Review,
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
      JobEvent, InjuryClaim, ClaimFollowUp, ChatMessage, Settlement, Appeal, Review,
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

  const sup1 = await users.save(users.create({
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

  // ---------- 工伤演示数据（脚踝扭伤 + 考勤缺失追查） ----------
  const assignmentRepo = source.getRepository(Assignment);
  const attendanceRepo = source.getRepository(AttendanceEvent);
  const policyRepo = source.getRepository(InsurancePolicy);
  const jobEventRepo = source.getRepository(JobEvent);
  const claimRepo = source.getRepository(InjuryClaim);
  const followRepo = source.getRepository(ClaimFollowUp);

  // 场景 A：工人陈刚，会展搭建中扭伤脚踝——四重到岗已完成、保险生效、主管已确认工伤，待客服发起保险报案
  const worker3 = await users.save(users.create({
    username: 'worker3', passwordHash: pwd, name: '陈刚', phone: '13800000003', role: 'WORKER',
    idCardNo: '310101199205053333', idVerifiedAt: new Date(),
    healthCertUntil: '2027-12-31', faceSampleUrl: 'seed://face-chengang',
  }));
  const exb = INDUSTRIES.EXHIBITION;
  const job7 = await jobs.save(jobs.create({
    enterpriseId: ent1.id, title: '国际车展·展台搭建突击', industry: 'EXHIBITION',
    description: '桁架、展具搬运与展台搭建，穿劳保鞋。', location: '上海市浦东新区国家会展中心',
    lat: 31.1905, lng: 121.4727,
    startTime: iso(-90), endTime: iso(300), headcount: 1,
    skillRequirement: '体力好', requireHealthCert: exb.healthCertRequired, dressCode: '劳保鞋+手套',
    dailyWage: 320, overtimeRate: 38, mealAllowance: 25, lateDeductPerMin: 2, lateGraceMinutes: 5,
    insuranceCoverageWan: 30, insurancePremium: Math.round(320 * exb.insuranceRate * 100) / 100,
    settlementMethod: '日结-完工24小时内', platformFeeRate: 0.08, status: 'IN_PROGRESS',
    depositRequired: Math.round(exb.baseDeposit * depositMultiplier(ent1.riskLevel)), depositPaid: true,
    strictConfirmation: false, prepayment: 0,
  } as Job));
  ent1.depositFrozen = Number(ent1.depositFrozen) + Number(job7.depositRequired);
  ent1.depositBalance = Number(ent1.depositBalance) - Number(job7.depositRequired);
  await enterprises.save(ent1);

  const a7 = await assignmentRepo.save(assignmentRepo.create({
    jobId: job7.id, workerId: worker3.id, status: 'WORKING', riskAcknowledged: true,
    appliedAt: iso(-120), acceptedAt: iso(-100), ratingSnapshot: 5, completedJobsCount: 6,
  }));
  const att7 = await attendanceRepo.save(attendanceRepo.create({
    assignmentId: a7.id, jobId: job7.id, workerId: worker3.id, kind: 'CHECK_IN',
    locationPassed: true, lat: 31.1905, lng: 121.4727, distanceMeters: 12,
    facePassed: true, faceScore: 95, supervisorConfirmed: true, confirmedBySupervisorId: sup1.id,
    confirmedAt: iso(-88), qrcodePassed: true, qrcodeToken: 'SEED0001', secondConfirmed: true,
    allPassed: true, failReason: null, photoUrl: 'seed://checkin-chengang', eventTime: iso(-90),
  }));
  const p7 = await policyRepo.save(policyRepo.create({
    assignmentId: a7.id, jobId: job7.id, workerId: worker3.id, enterpriseId: ent1.id,
    insurerProduct: '高危作业人员意外险·搭建专项', coverageWan: 30, premium: job7.insurancePremium,
    status: 'ACTIVE', effectiveFrom: iso(-90), activatedByAttendanceId: att7.id,
    jobRiskLevel: exb.baseRiskLevel, enterpriseConfirmed: true,
  }));
  const ev7 = await jobEventRepo.save(jobEventRepo.create({
    assignmentId: a7.id, jobId: job7.id, workerId: worker3.id, type: 'INJURY',
    description: '会展搭建搬运桁架时踩空台阶，扭伤右脚脚踝，当场肿胀无法承重',
    occurredAt: iso(-20), workPosition: '展台搭建-桁架组',
    photoUrl: 'seed://injury-ankle-1', extraPhotoUrls: 'seed://injury-ankle-2',
    medicalReceiptUrls: 'seed://receipt-guahao,seed://receipt-xray',
    lat: 31.1905, lng: 121.4727, status: 'APPROVED',
    reviewedBy: sup1.id, reviewedAt: iso(-18), reviewNote: '现场目击，已陪同就医，情况属实',
  }));
  const c7 = await claimRepo.save(claimRepo.create({
    assignmentId: a7.id, jobId: job7.id, workerId: worker3.id, enterpriseId: ent1.id,
    jobEventId: ev7.id, insurancePolicyId: p7.id,
    injuryDesc: ev7.description, accidentAt: iso(-20), workPosition: '展台搭建-桁架组',
    scenePhotoUrls: 'seed://injury-ankle-1,seed://injury-ankle-2',
    medicalReceiptUrls: 'seed://receipt-guahao,seed://receipt-xray',
    claimAmount: 6000, status: 'RECORDED', coveredAtOccurrence: true,
    supervisorConfirmed: true, supervisorConfirmedBy: sup1.id, supervisorConfirmedAt: iso(-18),
    supervisorNote: '现场目击，已陪同就医，情况属实',
    adjusterNote: '事故发生于保险保障期内，已完成现场记录与主管确认，等待客服发起报案',
  }));
  await followRepo.save(followRepo.create({
    claimId: c7.id, type: 'RECORD',
    content: `工人 ${worker3.name} 现场上报工伤：${ev7.description}；岗位：展台搭建-桁架组；事故时间以平台服务器时间为准；已上传现场照片与挂号/拍片票据`,
    attachmentUrls: 'seed://injury-ankle-1,seed://receipt-xray',
    operatorId: worker3.id, operatorRole: 'WORKER', operatorName: worker3.name,
    nextAction: '等待现场主管确认工伤事实',
  }));
  await followRepo.save(followRepo.create({
    claimId: c7.id, type: 'SUPERVISOR_CONFIRM',
    content: '现场主管确认工伤事实：现场目击，已陪同就医，情况属实',
    operatorId: sup1.id, operatorRole: 'SUPERVISOR', operatorName: sup1.name,
    nextAction: '客服核对事故时间/岗位/照片/票据/保险生效状态后发起保险报案',
  }));

  // 场景 B：工人周强，装卸时受伤——企业（主管）未按要求在系统确认到岗，三要素已过但四重未完成，保险未生效
  const worker4 = await users.save(users.create({
    username: 'worker4', passwordHash: pwd, name: '周强', phone: '13800000004', role: 'WORKER',
    idCardNo: '310101199307074444', idVerifiedAt: new Date(), faceSampleUrl: 'seed://face-zhouqiang',
  }));
  const wh = INDUSTRIES.WAREHOUSE;
  const job8 = await jobs.save(jobs.create({
    enterpriseId: ent1.id, title: '年货市集·冷库装卸帮工', industry: 'WAREHOUSE',
    description: '冷库货箱装卸。', location: '上海市嘉定区丰茂路物流园',
    lat: 31.3800, lng: 121.2500,
    startTime: iso(-70), endTime: iso(300), headcount: 1,
    skillRequirement: '无', requireHealthCert: false, dressCode: null,
    dailyWage: 260, overtimeRate: 30, mealAllowance: 20, lateDeductPerMin: 2, lateGraceMinutes: 5,
    insuranceCoverageWan: 20, insurancePremium: Math.round(260 * wh.insuranceRate * 100) / 100,
    settlementMethod: '日结-完工24小时内', platformFeeRate: 0.08, status: 'IN_PROGRESS',
    depositRequired: Math.round(wh.baseDeposit * depositMultiplier(ent1.riskLevel)), depositPaid: true,
    strictConfirmation: false, prepayment: 0,
  } as Job));
  ent1.depositFrozen = Number(ent1.depositFrozen) + Number(job8.depositRequired);
  ent1.depositBalance = Number(ent1.depositBalance) - Number(job8.depositRequired);
  await enterprises.save(ent1);

  const a8 = await assignmentRepo.save(assignmentRepo.create({
    jobId: job8.id, workerId: worker4.id, status: 'ACCEPTED', riskAcknowledged: true,
    appliedAt: iso(-100), acceptedAt: iso(-80), ratingSnapshot: 4.6, completedJobsCount: 3,
  }));
  await attendanceRepo.save(attendanceRepo.create({
    assignmentId: a8.id, jobId: job8.id, workerId: worker4.id, kind: 'CHECK_IN',
    locationPassed: true, lat: 31.3800, lng: 121.2500, distanceMeters: 30,
    facePassed: true, faceScore: 91, supervisorConfirmed: false,
    qrcodePassed: true, qrcodeToken: 'SEED0002', secondConfirmed: false,
    allPassed: false, failReason: '定位/人脸/二维码通过，等待现场主管确认',
    photoUrl: 'seed://checkin-zhouqiang', eventTime: iso(-60),
  }));
  const p8 = await policyRepo.save(policyRepo.create({
    assignmentId: a8.id, jobId: job8.id, workerId: worker4.id, enterpriseId: ent1.id,
    insurerProduct: '物流分拣雇主责任险', coverageWan: 20, premium: job8.insurancePremium,
    status: 'PENDING', effectiveFrom: null, jobRiskLevel: wh.baseRiskLevel, enterpriseConfirmed: true,
  }));
  const ev8 = await jobEventRepo.save(jobEventRepo.create({
    assignmentId: a8.id, jobId: job8.id, workerId: worker4.id, type: 'INJURY',
    description: '装卸货箱时滑倒，腰部扭伤', occurredAt: iso(-10),
    workPosition: '冷库装卸组', photoUrl: 'seed://injury-waist-1',
    medicalReceiptUrls: 'seed://receipt-yaobu', lat: 31.3800, lng: 121.2500, status: 'PENDING',
  }));
  const c8 = await claimRepo.save(claimRepo.create({
    assignmentId: a8.id, jobId: job8.id, workerId: worker4.id, enterpriseId: ent1.id,
    jobEventId: ev8.id, insurancePolicyId: p8.id,
    injuryDesc: ev8.description, accidentAt: iso(-10), workPosition: '冷库装卸组',
    scenePhotoUrls: 'seed://injury-waist-1', medicalReceiptUrls: 'seed://receipt-yaobu',
    claimAmount: 5000, status: 'RECORDED', coveredAtOccurrence: false,
    supervisorConfirmed: false,
    adjusterNote: '事故发生时保险未生效（主管未在系统确认到岗，四重校验未完成）；平台禁止事后补录保险，需追查考勤缺失对理赔的影响',
  }));
  await followRepo.save(followRepo.create({
    claimId: c8.id, type: 'RECORD',
    content: `工人 ${worker4.name} 现场上报工伤：${ev8.description}；岗位：冷库装卸组；就医票据已上传`,
    attachmentUrls: 'seed://receipt-yaobu',
    operatorId: worker4.id, operatorRole: 'WORKER', operatorName: worker4.name,
    nextAction: '主管未确认到岗——客服需追查考勤缺失对理赔的影响，并跟进医疗垫付与责任判定',
  }));

  console.log('[seed] 种子数据完成：worker1~4/enterprise1/supervisor1/enterprise_risky/support，密码均为 123456；含脚踝扭伤（待报案）与考勤缺失（待追查）两个工伤场景');
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
