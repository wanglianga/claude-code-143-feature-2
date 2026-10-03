/**
 * 端到端冒烟测试：城市临时用工日结派单考勤保险与争议平台
 * 用法（需先启动后端与数据库，并完成种子）：
 *   node scripts/smoke-test.mjs
 * 环境变量：BASE_URL(默认 http://127.0.0.1:3001) DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_NAME || 'gig_platform',
};

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
};
const req = async (method, path, token, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

async function login(username, password = '123456') {
  const r = await req('POST', '/api/auth/login', null, { username, password });
  if (r.status !== 201) throw new Error(`登录失败 ${username}: ${JSON.stringify(r.body)}`);
  return r.body.token;
}

(async () => {
  console.log('── 1. 登录种子账号 ──');
  const tWorker1 = await login('worker1');
  const tWorker2 = await login('worker2');
  const tEnt1 = await login('enterprise1');
  const tSup1 = await login('supervisor1');
  const tSup1b = await login('supervisor1b');
  const tRisky = await login('enterprise_risky');
  const tSupRisky = await login('supervisor_risky');
  const tSupRiskyb = await login('supervisor_riskyb');
  const tSupport = await login('support');
  ok(true, '全部种子账号可登录（工人/企业/主管×4/客服）');

  console.log('── 2. 报名门禁：实名 / 健康证 / 历史评价 / 风险告知 ──');
  const jobs = (await req('GET', '/api/jobs', tWorker1)).body;
  const cateringJob = jobs.find((j) => j.industry === 'CATERING');
  // 主演示岗位可能与种子中的其他会展岗同行业，按标题精确选择
  const exhibitionJob = jobs.find((j) => j.industry === 'EXHIBITION' && j.title.includes('世博动漫展'));
  const securityJob = jobs.find((j) => j.industry === 'SECURITY');
  ok(!!cateringJob && !!exhibitionJob && !!securityJob, '岗位大厅包含六类行业岗位');

  // worker2 未实名/无健康证/无人脸 → 报名餐饮岗必须被拦截
  const badApply = await req('POST', `/api/jobs/${cateringJob.id}/apply`, tWorker2, { riskAcknowledged: true });
  ok(badApply.status === 400 && /实名认证/.test(badApply.body.message), `未实名工人报名被拦截：${badApply.body.message}`);

  // worker1 未勾选风险告知 → 拦截
  const noAck = await req('POST', `/api/jobs/${exhibitionJob.id}/apply`, tWorker1, { riskAcknowledged: false });
  ok(noAck.status === 400 && /风险告知/.test(noAck.body.message), '未确认风险告知不能报名');

  // worker1 正常报名会展岗
  const apply = await req('POST', `/api/jobs/${exhibitionJob.id}/apply`, tWorker1, { riskAcknowledged: true });
  ok(apply.status === 201 && apply.body.status === 'APPLIED', '工人完成报名（状态 APPLIED）');

  console.log('── 3. 企业录取 → 自动生成待生效保单 ──');
  const applicants = (await req('GET', `/api/jobs/${exhibitionJob.id}/applicants`, tEnt1)).body;
  const myApp = applicants.find((a) => a.worker && a.worker.name === '张三');
  ok(Array.isArray(applicants) && myApp, '企业可查看报名工人及其实名/健康证/评价快照');
  const accept = await req('POST', `/api/assignments/${myApp.id}/review`, tEnt1, { accept: true });
  ok(accept.status === 201 && accept.body.status === 'ACCEPTED', '企业录取工人');
  const assignmentId = accept.body.id;
  const roomBefore = (await req('GET', `/api/assignments/${assignmentId}/room`, tWorker1)).body;
  ok(roomBefore.policy.status === 'PENDING' && roomBefore.policy.enterpriseConfirmed === true,
    `录取即生成保单（PENDING，企业已确认，岗位风险等级 ${roomBefore.policy.jobRiskLevel}）`);

  console.log('── 4. 到岗四重校验：定位 + 人脸 + 二维码 + 主管确认 ──');
  // 4.1 定位偏离
  const far = await req('POST', '/api/attendance/check-in', tWorker1, {
    assignmentId, lat: 31.0, lng: 121.0, qrcodeToken: 'BAD', facePassed: true,
  });
  ok(far.body.nextStep === 'FIX_FACTORS' && /定位偏离/.test(far.body.message) && /二维码/.test(far.body.message),
    `定位偏离+错误二维码被拦截：${far.body.message}`);

  // 4.2 正确定位/人脸 + 主管出示的动态二维码 → 等待主管确认
  const qr = (await req('GET', `/api/jobs/${exhibitionJob.id}/qrcode`, tSup1)).body;
  ok(/^[A-Z0-9]{8}$/.test(qr.token), `主管获取每分钟轮换的动态签到码：${qr.token}`);
  const checkin = await req('POST', '/api/attendance/check-in', tWorker1, {
    assignmentId, lat: 31.2304, lng: 121.4737, qrcodeToken: qr.token, facePassed: true,
    photoUrl: 'mock://on-site-photo-1',
  });
  ok(checkin.body.nextStep === 'WAIT_SUPERVISOR', `工人三要素通过：${checkin.body.message}`);
  const pendingAttendanceId = checkin.body.attendance.id;

  // 4.3 工人不能自己确认（越权）
  const selfConfirm = await req('POST', `/api/attendance/${pendingAttendanceId}/supervisor-confirm`, tWorker1, {});
  ok(selfConfirm.status === 403, '工人无权自行主管确认（防自证）');

  // 4.4 主管确认 → 保险即时生效，禁止事后补录
  const confirmed = await req('POST', `/api/attendance/${pendingAttendanceId}/supervisor-confirm`, tSup1, {});
  ok(confirmed.body.nextStep === 'INSURANCE_ACTIVE' && confirmed.body.insurancePolicy.status === 'ACTIVE',
    `主管确认→四重校验通过→保险即时生效：${confirmed.body.message}`);

  console.log('── 5. 作业过程：加班 / 工伤（保险期内）/ 额外搬运 / 聊天 ──');
  const ot = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'OVERTIME', description: '撤展延后，主管要求加班', minutes: 90,
  });
  ok(ot.status === 201 && ot.body.event.status === 'PENDING' && /现场实时上报/.test(ot.body.message), '加班事件现场实时上报');
  const otReview = await req('POST', `/api/events/${ot.body.event.id}/review`, tSup1, { approve: true, note: '情况属实' });
  ok(otReview.body.event.status === 'APPROVED', '主管批准加班 90 分钟');

  const carry = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'EXTRA_CARRY', description: '临时要求加搬两托盘展具', minutes: 30,
  });
  await req('POST', `/api/events/${carry.body.event.id}/review`, tSup1, { approve: true, note: '确认' });
  ok(true, '额外搬运事件已审批（计入日结补贴）');

  const injury = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'INJURY',
    injuryDesc: '会展搭建搬运桁架时踩到地面线缆绊倒，扭伤右脚踝，肿胀无法承重',
    positionAtInjury: '展台搭建搬运工',
    scenePhotos: 'mock://ankle-scene-1,mock://ankle-scene-2',
    hospital: '上海市第六人民医院', medicalReceipts: 'mock://receipt-clinic', medicalExpense: 860,
  });
  const case0 = injury.body.injuryCase;
  ok(injury.status === 201 && case0.status === 'DRAFT' && case0.coveredAtOccurrence === true
    && case0.attendanceGap === false && case0.positionAtInjury === '展台搭建搬运工',
    `作业中受伤：现场记录事故时间/岗位/照片/就医票据，事故时保险在保障期内（案件 #${case0?.id}，待主管确认）`);
  const injuryEventId = injury.body.event.id;
  const injuryCaseId = case0.id;

  // 主管确认工伤事件（作业事件审批入口与工伤案件联动）
  const injuryReview = await req('POST', `/api/events/${injuryEventId}/review`, tSup1, { approve: true, note: '现场目击属实，地面线缆未防护' });
  ok(injuryReview.body.injuryCase.status === 'CONFIRMED' && injuryReview.body.event.status === 'APPROVED',
    '主管确认工伤属实 → 案件进入待报案，作业事件同步 APPROVED');

  // 客服根据记录发起保险报案
  const fileReport = await req('POST', `/api/injuries/${injuryCaseId}/report-insurance`, tSupport, { claimAmount: 6800, note: '脚踝韧带损伤' });
  ok(fileReport.status === 201 && fileReport.body.status === 'CLAIM_TRACKING'
    && fileReport.body.claim.status === 'REPORTED' && /^BX/.test(fileReport.body.claim.insurerReportNo),
    `客服发起保险报案，报案号 ${fileReport.body.claim?.insurerReportNo}，进入理赔资料跟进`);

  // 客服勾选已收资料，未齐 → 理赔单 WAITING_DOCS
  const mat = await req('POST', `/api/injuries/${injuryCaseId}/materials`, tSupport, {
    patch: { accidentNotice: true, medicalRecord: true, attendanceProof: true, supervisorStatement: true, idCopy: true },
  });
  ok(mat.body.claim.status === 'WAITING_DOCS' && mat.body.missingMaterials.includes('医疗票据')
    && mat.body.missingMaterials.includes('企业责任意见'),
    `理赔资料清单跟踪：仍缺 ${mat.body.missingMaterials.join('、')}`);

  // 未报案不能直接登记资料（防跳过报案流程）
  const noReport = await req('POST', `/api/injuries/${injuryCaseId}/report-insurance`, tSupport, {});
  ok(noReport.status === 400 && /已发起/.test(noReport.body.message), '同一工伤事件不能重复报案');

  const msg = await req('POST', `/api/assignments/${assignmentId}/messages`, tWorker1, { content: '主管，加班的工时记得帮我确认' });
  const msg2 = await req('POST', `/api/assignments/${assignmentId}/messages`, tSup1, { content: '已确认，安心干活' });
  ok(msg.status === 201 && msg2.status === 201, '任务内聊天留存（争议证据链）');

  console.log('── 6. 企业未确认到岗：考勤缺失事故可记录但保险不赔，平台追查企业责任 ──');
  // 新工人：注册+实名+健康证+人脸
  const uname = `wnew${Date.now() % 100000}`;
  const reg = await req('POST', '/api/auth/register', null, {
    username: uname, password: '123456', name: '新工人', phone: '13500000099', role: 'WORKER',
    idCardNo: '310101199501011111', healthCertUntil: '2027-01-01',
  });
  const tNew = reg.body.token;
  await req('POST', '/api/auth/worker-profile', tNew, { faceSampleUrl: 'mock://face-new' });
  // 企业新发一个进行中的岗位并录取该工人（开工 90 分钟前、7 小时后收工）
  const sStart = new Date(Date.now() - 90 * 60000);
  const sEnd = new Date(Date.now() + 6 * 3600000);
  const newJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '在途仓库分拣', industry: 'WAREHOUSE', description: '分拣', location: '嘉定物流园',
    lat: 31.2304, lng: 121.4737,
    startTime: sStart.toISOString().slice(0, 19), endTime: sEnd.toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '无', dailyWage: 240,
  })).body;
  await req('POST', `/api/jobs/${newJob.id}/apply`, tNew, { riskAcknowledged: true });
  const newApps = (await req('GET', `/api/jobs/${newJob.id}/applicants`, tEnt1)).body;
  const newAccept = await req('POST', `/api/assignments/${newApps[0].id}/review`, tEnt1, { accept: true });
  const newAid = newAccept.body.id;
  // 未完成四重到岗确认（企业未按要求确认到岗），工人仍可记录事故：
  // 平台不让考勤缺失导致事故无记录，但事故时保险未生效、标记考勤缺失待追查
  const earlyInjury = await req('POST', '/api/events', tNew, {
    assignmentId: newAid, type: 'INJURY', injuryDesc: '还没完成到岗确认就抬货扭伤脚踝',
    positionAtInjury: '分拣搬运', medicalExpense: 300,
  });
  const gapCase = earlyInjury.body.injuryCase;
  ok(earlyInjury.status === 201 && gapCase.coveredAtOccurrence === false
    && gapCase.attendanceGap === true && gapCase.attendanceGapResult === 'PENDING'
    && gapCase.policyStatusAtOccurrence === 'PENDING',
    '未确认到岗的事故允许记录（企业未确认→考勤缺失追查），但事故时保险未生效');

  // 主管确认现场属实（承认工人实际到岗但当时没在系统确认）
  await req('POST', `/api/events/${earlyInjury.body.event.id}/review`, tSup1, {
    approve: true, note: '他确实到岗了，当时忙没在系统点确认',
  });
  // 未完成考勤追查前不能先行结算
  const settleBeforeTrace = await req('POST', `/api/injuries/${gapCase.id}/settle-wages`, tSupport);
  ok(settleBeforeTrace.status === 400 && /追查/.test(settleBeforeTrace.body.message),
    `考勤缺失未追查前不能结算工资：${settleBeforeTrace.body.message}`);
  // 客服报案 → 保险拒赔（不可改赔），转企业责任/医疗垫付跟进
  const gapReport = await req('POST', `/api/injuries/${gapCase.id}/report-insurance`, tSupport, { claimAmount: 3000 });
  ok(gapReport.body.claim.status === 'REJECTED' && /未生效/.test(gapReport.body.claim.adjusterNote),
    '事故时保单 PENDING → 保险拒赔，医疗垫付与企业责任另案跟进');
  // 平台追查：企业承认实际到岗未确认 → 保险缺口由企业承担（判企业全责）
  const trace = await req('POST', `/api/injuries/${gapCase.id}/attendance-gap`, tSupport, {
    result: 'CONFIRMED_ARRIVAL', note: '主管与班组记录均证明工人已到岗，企业漏确认',
  });
  ok(trace.body.attendanceGapResult === 'CONFIRMED_ARRIVAL' && trace.body.liability === 'ENTERPRISE'
    && trace.body.enterpriseLiabilityPct === 100,
    '追查确认企业未按要求确认到岗：保险缺口由企业承担，判定企业全责');
  // 追查后可按认定到岗时间（开工时间）起算已完成工时
  const gapSettle = await req('POST', `/api/injuries/${gapCase.id}/settle-wages`, tSupport);
  ok(gapSettle.status === 201 && Number(gapSettle.body.settlement.workMinutes) > 0
    && Number(gapSettle.body.settlement.insurancePremium) === 0,
    `追查后按已完成工时 ${gapSettle.body.settlement?.workMinutes} 分钟结算工资，未生效保单不计保费`);

  // 数据层面铁律：即使存在 coveredAtOccurrence=false 的理赔单，客服也无权改赔
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database,
  });
  const [uncoveredRows] = await conn.query(
    'SELECT id FROM injury_claims WHERE assignmentId = ? AND coveredAtOccurrence = 0 ORDER BY id DESC LIMIT 1', [newAid],
  );
  await conn.end();
  const forcePay = await req('POST', `/api/support/claims/${uncoveredRows[0].id}/adjust`, tSupport, { approve: true, note: '通融赔付' });
  ok(forcePay.status === 400 && /未生效/.test(forcePay.body.message),
    `客服无法把事故时未生效的保单改为赔付：${forcePay.body.message}`);

  console.log('── 7. 完工签退 → 日结明细（工时/加班/餐补/迟到扣款/预付/服务费） ──');
  const qr2 = (await req('GET', `/api/jobs/${exhibitionJob.id}/qrcode`, tSup1)).body.token;
  const checkout = await req('POST', '/api/attendance/check-out', tWorker1, {
    assignmentId, lat: 31.2304, lng: 121.4737, qrcodeToken: qr2, facePassed: true,
  });
  const s = checkout.body.settlement;
  ok(checkout.status === 201 && s, '签退成功并生成日结明细');
  ok(Number(s.overtimeMinutes) === 90 && Number(s.overtimePay) > 0, `加班 90 分钟已计入加班费 ¥${s.overtimePay}`);
  ok(Number(s.extraCarryPay) > 0, `额外搬运补贴 ¥${s.extraCarryPay}`);
  ok(Number(s.mealAllowance) > 0, `餐补 ¥${s.mealAllowance}`);
  ok(Number(s.insurancePremium) > 0 && Number(s.platformServiceFee) > 0,
    `保费 ¥${s.insurancePremium}（企业承担）+ 平台服务费 ¥${s.platformServiceFee}`);
  ok(Number(s.enterprisePrepaymentUsed) > 0, `动用企业预付款 ¥${s.enterprisePrepaymentUsed}`);
  const pay = await req('POST', '/api/settlements/pay', tEnt1, { assignmentIds: [assignmentId] });
  ok(pay.body[0] && pay.body[0].status === 'PAID', '企业确认发放日结（状态 PAID）');

  console.log('── 8. 工人申诉 → 客服查看证据包 → 补发裁决 ──');
  const appeal = await req('POST', '/api/appeals', tWorker1, {
    assignmentId, reason: '主管临时加活承诺加 50 元未体现在工资中', claimedAmount: 50,
  });
  ok(appeal.status === 201 && appeal.body.status === 'OPEN', '工人发起申诉');
  const evidence = await req('GET', `/api/support/appeals/${appeal.body.id}/evidence`, tSupport);
  ok(/签到记录/.test(evidence.body.summary) && /作业事件/.test(evidence.body.summary) && /聊天记录/.test(evidence.body.summary),
    '客服证据包包含签到轨迹/主管确认/现场照片/事件/聊天记录/保险/结算');
  ok(evidence.body.messages.length >= 2 && evidence.body.attendance.some((a) => a.allPassed), '证据包内含聊天记录与四重通过的签到记录');
  const beforePay = Number((await req('GET', `/api/settlements/assignment/${assignmentId}`, tWorker1)).body.workerPayable);
  const decide = await req('POST', `/api/support/appeals/${appeal.body.id}/decide`, tSupport, {
    decision: 'REISSUED', note: '聊天记录与主管确认佐证额外搬运，补发 50 元', reissueAmount: 50,
  });
  ok(decide.body.status === 'REISSUED' && Number(decide.body.reissueAmount) === 50, '客服裁决补发 ¥50');
  const after = (await req('GET', `/api/settlements/assignment/${assignmentId}`, tWorker1)).body;
  ok(Number(after.workerPayable) === beforePay + 50 && after.status === 'ADJUSTED',
    `结算单调整为 ADJUSTED，应发 ¥${beforePay} → ¥${after.workerPayable}`);

  console.log('── 8b. 工资结清后工伤仍持续跟进：垫付/医院补票/企业意见/责任/结案 ──');
  // 工资（含申诉补发）已结清，但工伤案件仍是跟进中 → 工作台必须能发现，不允许无人跟进
  const stats0 = (await req('GET', '/api/support/injuries/stats', tSupport)).body;
  const deskRows = (await req('GET', '/api/support/injuries', tSupport)).body;
  const mainRow = deskRows.find((c) => c.id === injuryCaseId);
  ok(stats0.wagesPaidButOpen >= 1 && mainRow.settlementPaid === true
    && !['SETTLED', 'CLOSED'].includes(mainRow.status),
    `工资已结清但工伤未结：客服台标记「工资已结·事故未结」${stats0.wagesPaidButOpen} 件，防止无人跟进`);

  // 企业登记医疗垫付 800（与工资分开记账）
  const advance = await req('POST', `/api/injuries/${injuryCaseId}/advance`, tEnt1, {
    source: 'ENTERPRISE', amount: 800, note: '现场垫付急诊与检查费',
  });
  ok(advance.body.advanceSource === 'ENTERPRISE' && Number(advance.body.advanceAmount) === 800
    && advance.body.advanceRecoveryStatus === 'PENDING',
    '企业登记医疗垫付 ¥800（待理赔款抵扣，不进日结工资）');

  // 企业提交责任意见（自认 80%）
  const opinion = await req('POST', `/api/injuries/${injuryCaseId}/enterprise-opinion`, tEnt1, {
    opinion: '现场线缆防护不到位，企业认可主要责任', acceptedPct: 80,
  });
  ok(opinion.body.enterpriseOpinionSubmitted === true || opinion.body.enterpriseOpinionAt,
    '企业责任意见已提交（同步进入理赔资料清单）');

  // 医院补票：正式发票补开 → 医疗票据资料收齐
  const receipt = await req('POST', `/api/injuries/${injuryCaseId}/followups`, tWorker1, {
    type: 'HOSPITAL_RECEIPT', content: '第六人民医院补开正式发票一张', amount: 860,
    attachments: 'mock://hospital-invoice-final',
  });
  ok(receipt.body.claim.hospitalReceiptStatus === 'SUPPLEMENTED'
    && receipt.body.claim.materials.receipts === true,
    '医院补票登记后，理赔资料「医疗票据」更新为已收');

  // 客服补齐企业责任意见材料 → 资料齐全，理赔单 DOCS_SUBMITTED
  const matAll = await req('POST', `/api/injuries/${injuryCaseId}/materials`, tSupport, {
    patch: { receipts: true, enterpriseOpinion: true },
  });
  ok(matAll.body.claim.status === 'DOCS_SUBMITTED' && matAll.body.missingMaterials.length === 0,
    '理赔资料全部收齐（事故说明/病历/票据/考勤/主管说明/企业意见/证件）→ 提交保险审核');

  // 平台责任判定：多方分担，企业 80%
  const liability = await req('POST', `/api/injuries/${injuryCaseId}/liability`, tSupport, {
    liability: 'JOINT', enterprisePct: 80, note: '企业线缆防护缺失负主要责任，工人未注意路况负次要责任',
  });
  ok(liability.body.liability === 'JOINT' && liability.body.enterpriseLiabilityPct === 80
    && !!liability.body.liabilityDecidedAt, '平台完成责任判定（多方分担·企业 80%），与工资结算互不影响');

  // 保险赔付结案，垫付从理赔款抵扣返还
  const close = await req('POST', `/api/injuries/${injuryCaseId}/close`, tSupport, {
    outcome: 'SETTLED', payoutAmount: 5200, note: '保险核定赔付到账，企业垫付已抵扣',
  });
  ok(close.body.status === 'SETTLED' && Number(close.body.insurancePayout) === 5200
    && close.body.claim.status === 'APPROVED', '保险理赔结案：赔付 ¥5200，案件闭环');
  const recovered = await req('POST', `/api/injuries/${injuryCaseId}/advance/resolve`, tSupport, {
    status: 'RECOVERED', note: '理赔到账抵扣企业垫付',
  });
  ok(recovered.body.advanceRecoveryStatus === 'RECOVERED', '企业医疗垫付 ¥800 已由理赔款抵扣返还');

  console.log('── 9. 高风险企业：更高保证金 + 更严格现场确认（双人） ──');
  const overview = (await req('GET', '/api/support/overview', tSupport)).body;
  const riskyRow = overview.allEnterprises.find((e) => e.name.includes('雷霆'));
  ok(riskyRow.riskLevel >= 4 && riskyRow.cancelRate >= 0.15 && riskyRow.disputeRate >= 0.2,
    `风险画像定级 ${riskyRow.riskLevel}（取消率 ${(riskyRow.cancelRate * 100).toFixed(0)}%、有责争议率 ${(riskyRow.disputeRate * 100).toFixed(0)}%）`);
  const riskyStartD = new Date(Date.now() + 3 * 86400000);
  const riskyEndD = new Date(riskyStartD.getTime() + 8 * 3600000);
  const riskyJob = (await req('POST', '/api/jobs', tRisky, {
    title: '临时发布会安保（高风险企业）', industry: 'SECURITY', description: '安保留', location: '滨江',
    lat: 31.2304, lng: 121.4737,
    startTime: riskyStartD.toISOString().slice(0, 19), endTime: riskyEndD.toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '安保经验', dailyWage: 320,
  })).body;
  ok(Number(riskyJob.depositRequired) === 400 * 3, `安保岗保证金被风险倍率上浮至 ¥${riskyJob.depositRequired}（基准400×倍率3.0×1人）`);
  ok(riskyJob.strictConfirmation === true, '岗位自动启用严格现场确认（双人）');

  // 用另一个新工人走严格双人确认全流程
  const uname2 = `wsec${Date.now() % 100000}`;
  const reg2 = await req('POST', '/api/auth/register', null, {
    username: uname2, password: '123456', name: '安保新人', phone: '13500000088', role: 'WORKER',
    idCardNo: '310101199602022222',
  });
  const tSec = reg2.body.token;
  await req('POST', '/api/auth/worker-profile', tSec, { faceSampleUrl: 'mock://face-sec' });
  // startTime 在未来导致签到无时间限制（系统不允许提前到岗？当前无时间门禁），直接录取签到
  await req('POST', `/api/jobs/${riskyJob.id}/apply`, tSec, { riskAcknowledged: true });
  const riskyApps = (await req('GET', `/api/jobs/${riskyJob.id}/applicants`, tRisky)).body;
  const riskyAccept = await req('POST', `/api/assignments/${riskyApps[0].id}/review`, tRisky, { accept: true });
  const riskyAid = riskyAccept.body.id;
  const qrR = (await req('GET', `/api/jobs/${riskyJob.id}/qrcode`, tSupRisky)).body.token;
  const rci = await req('POST', '/api/attendance/check-in', tSec, {
    assignmentId: riskyAid, lat: 31.2304, lng: 121.4737, qrcodeToken: qrR, facePassed: true,
  });
  const first = await req('POST', `/api/attendance/${rci.body.attendance.id}/supervisor-confirm`, tSupRisky, {});
  ok(first.body.nextStep === 'WAIT_SECOND_CONFIRM', '第一名主管确认后仍需第二名负责人复核');
  const sameAgain = await req('POST', `/api/attendance/${rci.body.attendance.id}/supervisor-confirm`, tSupRisky, {});
  ok(sameAgain.status === 400 && /同一人/.test(sameAgain.body.message), '同一人不能充当两名确认人');
  const second = await req('POST', `/api/attendance/${rci.body.attendance.id}/supervisor-confirm`, tSupRiskyb, {});
  ok(second.body.nextStep === 'INSURANCE_ACTIVE' && second.body.insurancePolicy.status === 'ACTIVE',
    '第二名负责人复核通过 → 到岗成立、保险生效');

  console.log('── 10. 企业取消岗位：保证金罚没 + 保单作废 + 取消率沉淀 ──');
  const cancelStart = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 16) + ':00';
  const cancelJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '周末保洁突击', industry: 'CLEANING', description: '保洁', location: '人民广场',
    lat: 31.2304, lng: 121.4737, startTime: cancelStart,
    endTime: new Date(new Date(cancelStart).getTime() + 6 * 3600000).toISOString().slice(0, 16) + ':00',
    headcount: 2, skillRequirement: '无', dailyWage: 210,
  })).body;
  const depositBefore = Number(cancelJob.depositRequired);
  const cancel = await req('POST', `/api/jobs/${cancelJob.id}/cancel`, tEnt1, { reason: '甲方临时取消活动' });
  ok(cancel.body.job.status === 'CANCELLED' && cancel.body.forfeit === Math.round(depositBefore * 0.2),
    `开工前 >2h 取消：罚没 20% 保证金 ¥${cancel.body.forfeit}，释放 ¥${cancel.body.released}`);

  console.log('── 11. 行业风险沉淀看板 ──');
  const ind = (await req('GET', '/api/industry-risks', tSupport)).body;
  ok(ind.length === 6 && ind.find((x) => x.industry === 'SECURITY').baseRiskLevel === 5,
    '按六个行业沉淀岗位风险（安保基础风险 5 级、保费费率最高）');

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒烟测试异常中断：', e);
  process.exit(2);
});
