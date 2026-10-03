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
  const cateringJob = jobs.find((j) => j.industry === 'CATERING' && j.status === 'OPEN');
  const exhibitionJob = jobs.find((j) => j.industry === 'EXHIBITION' && j.status === 'OPEN');
  const securityJob = jobs.find((j) => j.industry === 'SECURITY' && j.status === 'OPEN');
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

  // 工伤上报必须填写受伤岗位
  const injuryNoPos = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'INJURY', description: '脚扭了', claimAmount: 8000,
  });
  ok(injuryNoPos.status === 400 && /岗位/.test(injuryNoPos.body.message),
    `工伤上报缺少受伤岗位被拦截：${injuryNoPos.body.message}`);

  const injury = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'INJURY', description: '搬运桁架时踩空扭伤右脚脚踝', claimAmount: 8000,
    workPosition: '展台搭建-桁架组',
    photoUrl: 'mock://ankle-a', extraPhotoUrls: 'mock://ankle-b,mock://ankle-c',
    medicalReceiptUrls: 'mock://guahao,mock://xray',
  });
  ok(injury.status === 201 && injury.body.claim.coveredAtOccurrence === true && injury.body.claim.status === 'RECORDED',
    '作业中扭伤脚踝 → 现场记录工伤单（RECORDED），事故时间/岗位/照片/票据/保险状态已固化');
  ok(!!injury.body.claim.accidentAt && injury.body.claim.workPosition === '展台搭建-桁架组'
    && /mock:\/\/xray/.test(injury.body.claim.scenePhotoUrls + injury.body.claim.medicalReceiptUrls),
    '工伤单六要素齐全：事故时间（服务器）、岗位、现场照片、就医票据、保险生效状态');
  const injuryReview = await req('POST', `/api/events/${injury.body.event.id}/review`, tSup1, { approve: true, note: '现场目击属实，已陪同就医' });
  ok(injuryReview.body.claim.supervisorConfirmed === true && injuryReview.body.claim.status === 'RECORDED',
    '主管确认的是「工伤事实」，不替保险下赔付结论（理赔单仍待客服报案）');

  const msg = await req('POST', `/api/assignments/${assignmentId}/messages`, tWorker1, { content: '主管，加班的工时记得帮我确认' });
  const msg2 = await req('POST', `/api/assignments/${assignmentId}/messages`, tSup1, { content: '已确认，安心干活' });
  ok(msg.status === 201 && msg2.status === 201, '任务内聊天留存（争议证据链）');

  console.log('── 5b. 客服保险报案：未报案不能赔付 → 报案 → 资料/补票/医疗垫付 → 核定赔付 ──');
  const claimId = injury.body.claim.id;
  const adjustBeforeReport = await req('POST', `/api/claims/${claimId}/adjust`, tSupport, { approve: true, note: '先赔了再说' });
  ok(adjustBeforeReport.status === 400 && /报案/.test(adjustBeforeReport.body.message),
    `未向保险公司报案不能核定赔付：${adjustBeforeReport.body.message}`);
  const report = await req('POST', `/api/claims/${claimId}/report`, tSupport, { note: '六要素齐全，正式报案' });
  ok(report.status === 201 && report.body.claim.status === 'REPORTED' && !!report.body.claim.insurerReportNo,
    `客服依据记录发起保险报案（报案号 ${report.body.claim.insurerReportNo}）`);
  const mats = await req('POST', `/api/claims/${claimId}/materials`, tSupport, {
    complete: true, note: '病历/诊断证明/挂号拍片票据齐套', missingItems: '',
  });
  ok(mats.body.claim.materialsComplete === true && mats.body.claim.status === 'INVESTIGATING', '理赔资料齐套，进入保险核定');
  const moreReceipts = await req('POST', `/api/claims/${claimId}/receipts`, tWorker1, {
    receiptUrls: 'mock://fuzhen-1,mock://yaofei-2', note: '复查与药品票据',
  });
  ok(moreReceipts.status === 201 && moreReceipts.body.claim.medicalReceipts.length >= 4,
    `工人治疗后继续补交医院票据（累计 ${moreReceipts.body.claim.medicalReceipts.length} 张），理赔不因时间推移断档`);
  const advance = await req('POST', `/api/claims/${claimId}/medical-advance`, tSupport, {
    amount: 800, by: 'PLATFORM', note: '平台凭票据先行垫付，后续向保险/责任方追偿', receiptUrls: 'mock://xray',
  });
  ok(Number(advance.body.claim.medicalAdvanceAmount) === 800 && advance.body.claim.medicalAdvanceBy === 'PLATFORM',
    '医疗垫付 ¥800 单独记账，与日结工资分开、不冲抵');
  const approved = await req('POST', `/api/claims/${claimId}/adjust`, tSupport, { approve: true, note: '属于保险责任，核定赔付' });
  ok(approved.body.claim.status === 'APPROVED', '保险公司核定赔付');
  const detail = await req('GET', `/api/claims/${claimId}`, tSupport);
  ok(detail.body.followUps.length >= 5 && detail.body.followUps.some((f) => f.type === 'REPORT')
    && detail.body.followUps.some((f) => f.type === 'MEDICAL_ADVANCE'),
    `理赔跟进时间线 ${detail.body.followUps.length} 条：记录/主管确认/报案/资料/补票/垫付均有留痕，工资结清后仍可追溯`);

  console.log('── 6. 保险不可事后补录（未到岗先受伤 → 不能立案为保险事故） ──');
  // 新工人：注册+实名+健康证+人脸
  const uname = `wnew${Date.now() % 100000}`;
  const reg = await req('POST', '/api/auth/register', null, {
    username: uname, password: '123456', name: '新工人', phone: '13500000099', role: 'WORKER',
    idCardNo: '310101199501011111', healthCertUntil: '2027-01-01',
  });
  const tNew = reg.body.token;
  await req('POST', '/api/auth/worker-profile', tNew, { faceSampleUrl: 'mock://face-new' });
  // 企业新发一个岗并录取该工人
  const sStart = new Date(Date.now() + 2 * 86400000);
  const sEnd = new Date(sStart.getTime() + 8 * 3600000);
  const newJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '次日仓库分拣', industry: 'WAREHOUSE', description: '分拣', location: '嘉定物流园',
    lat: 31.2304, lng: 121.4737,
    startTime: sStart.toISOString().slice(0, 19), endTime: sEnd.toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '无', dailyWage: 240,
  })).body;
  await req('POST', `/api/jobs/${newJob.id}/apply`, tNew, { riskAcknowledged: true });
  const newApps = (await req('GET', `/api/jobs/${newJob.id}/applicants`, tEnt1)).body;
  const newAccept = await req('POST', `/api/assignments/${newApps[0].id}/review`, tEnt1, { accept: true });
  const newAid = newAccept.body.id;
  // 未完成任何到岗校验，直接报受伤 → 系统拒绝（保险 PENDING）
  const earlyInjury = await req('POST', '/api/events', tNew, {
    assignmentId: newAid, type: 'INJURY', description: '还没到岗就受伤了想走保险',
  });
  ok(earlyInjury.status === 400 && /作业中/.test(earlyInjury.body.message),
    `未到岗（保险未生效）不能报工伤立案：${earlyInjury.body.message}`);

  // 数据层面：即使存在 coveredAtOccurrence=false 的理赔单，客服也无权改赔
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database,
  });
  const [pl] = await conn.query('SELECT id FROM insurance_policies WHERE assignmentId = ?', [newAid]);
  await conn.query(
    'INSERT INTO injury_claims (assignmentId, jobId, workerId, enterpriseId, jobEventId, insurancePolicyId, injuryDesc, accidentAt, claimAmount, status, coveredAtOccurrence, createdAt) VALUES (?,?,?,?,?,?,?,NOW(),?,?,?,NOW())',
    [newAid, newJob.id, newApps[0].workerId, newJob.enterpriseId, 0, pl[0].id, '事故时未到岗', 5000, 'REPORTED', 0],
  );
  const [uncoveredRows] = await conn.query(
    'SELECT id FROM injury_claims WHERE assignmentId = ? AND coveredAtOccurrence = 0 ORDER BY id DESC LIMIT 1', [newAid],
  );
  await conn.end();
  const forcePay = await req('POST', `/api/claims/${uncoveredRows[0].id}/adjust`, tSupport, { approve: true, note: '通融赔付' });
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

  console.log('── 12. 种子工伤场景：脚踝扭伤（待报案）+ 考勤缺失（企业未确认到岗）全流程 ──');
  const allClaims = (await req('GET', '/api/claims', tSupport)).body;
  const cAnkle = allClaims.find((c) => c.workerName === '陈刚');
  const cAtt = allClaims.find((c) => c.workerName === '周强');
  ok(!!cAnkle && !!cAtt, '客服理赔台可看到种子工伤单（陈刚·脚踝扭伤 / 周强·考勤缺失）');

  // 场景 A：陈刚——六要素齐全、主管已确认、保险在保障期
  ok(cAnkle.coveredAtOccurrence === true && cAnkle.supervisorConfirmed === true
    && cAnkle.workPosition === '展台搭建-桁架组' && cAnkle.scenePhotos.length >= 2 && cAnkle.medicalReceipts.length >= 2,
    '脚踝扭伤单记录齐全：事故时间/岗位/现场照片/主管确认/就医票据/保险生效状态');
  const ankleDetail = (await req('GET', `/api/claims/${cAnkle.id}`, tSupport)).body;
  ok(ankleDetail.attendanceAnalysis.issue === false && ankleDetail.followUps.some((f) => f.type === 'SUPERVISOR_CONFIRM'),
    '四重考勤完整、主管确认已进入跟进时间线');
  // 工伤离场、无完工签退 → 按到岗至事故的已完成工时先行结算
  const ankleWage = await req('POST', `/api/claims/${cAnkle.id}/settle-wage`, tSupport, {});
  ok(ankleWage.status === 201 && Number(ankleWage.body.settlement.workerPayable) > 0
    && Number(ankleWage.body.settlement.workerPayable) < ankleDetail.job.dailyWage,
    `脚踝扭伤未签退：日结按已完成工时 ${ankleWage.body.settlement.workMinutes} 分钟先行结算 ¥${ankleWage.body.settlement.workerPayable}（< 全日 ¥${ankleDetail.job.dailyWage}）`);
  const ankleReport = await req('POST', `/api/claims/${cAnkle.id}/report`, tSupport, { note: '种子脚踝扭伤单正式报案' });
  ok(ankleReport.body.claim.status === 'REPORTED' && ankleReport.body.claim.reportedToInsurer === true, '客服为陈刚发起保险报案');
  // 工人只能访问本人工伤单
  const trespass = await req('GET', `/api/claims/${cAnkle.id}`, tWorker2);
  ok(trespass.status === 403, '工人无权查看他人的工伤理赔单');

  // 场景 B：周强——三要素已过但主管未确认，保险未生效
  ok(cAtt.coveredAtOccurrence === false && cAtt.supervisorConfirmed === false,
    '周强事故时保险未生效（企业主管未在系统确认到岗）');
  const attDetail0 = (await req('GET', `/api/claims/${cAtt.id}`, tSupport)).body;
  ok(attDetail0.attendanceAnalysis.issue === true
    && /未在系统中确认|主管未确认/.test(attDetail0.attendanceAnalysis.issues.join('')),
    '系统考勤分析识别：定位/人脸/二维码已过但主管未确认，影响理赔、企业举证不利');
  // 无有效到岗前不能按工时结算
  const wageTooEarly = await req('POST', `/api/claims/${cAtt.id}/settle-wage`, tSupport, {});
  ok(wageTooEarly.status === 400 && /考勤/.test(wageTooEarly.body.message),
    `考勤未追查前不能按工时结算：${wageTooEarly.body.message}`);
  // 平台核实代报案前必须先追查考勤
  const reportTooEarly = await req('POST', `/api/claims/${cAtt.id}/report`, tSupport, { platformVerified: true, note: '先报了' });
  ok(reportTooEarly.status === 400 && /考勤缺失追查/.test(reportTooEarly.body.message),
    `主管未确认时平台代报案须先完成考勤追查：${reportTooEarly.body.message}`);
  // 客服追查考勤缺失：认定企业责任 + 事后认定实际到岗（仅用于工资/责任，保险不追溯）
  const attCheck = await req('POST', `/api/claims/${cAtt.id}/attendance-check`, tSupport, {
    note: '主管现场在场却未在系统确认到岗，企业承担考勤缺失的举证不利后果',
    enterpriseAtFault: true, recognizeArrival: true,
  });
  ok(attCheck.body.claim.attendanceIssue === true
    && attCheck.body.attendanceAnalysis.retroRecognized === true
    && attCheck.body.claim.coveredAtOccurrence === false,
    '事后认定实际到岗仅供工资/责任使用，coveredAtOccurrence 与保险生效时间不被追溯改写');
  // 认定后可按已完成工时结算（金额按事故时间截断）
  const attWage = await req('POST', `/api/claims/${cAtt.id}/settle-wage`, tSupport, {});
  ok(attWage.status === 201 && Number(attWage.body.settlement.workerPayable) > 0
    && Number(attWage.body.settlement.workerPayable) < attDetail0.job.dailyWage,
    `周强按事后认定到岗+已完成工时结算 ¥${attWage.body.settlement.workerPayable}，工资不被考勤/保险纠纷阻塞`);
  // 企业提交责任意见
  const entOp = await req('POST', `/api/claims/${cAtt.id}/enterprise-opinion`, tEnt1, { opinion: '现场忙乱漏点确认，认可企业管理疏漏，愿协商承担医疗费用' });
  ok(entOp.status === 201 && !!entOp.body.claim.enterpriseOpinion, '企业提交责任意见并进入跟进时间线');
  // 平台核实后报案留档 → 保险仍只能拒赔（禁止改赔）
  const attReport = await req('POST', `/api/claims/${cAtt.id}/report`, tSupport, { platformVerified: true, note: '平台核实后代为报案留档' });
  ok(attReport.body.claim.status === 'REPORTED', '平台考勤追查核实后代为报案留档');
  const attForceApprove = await req('POST', `/api/claims/${cAtt.id}/adjust`, tSupport, { approve: true, note: '通融' });
  ok(attForceApprove.status === 400 && /未生效/.test(attForceApprove.body.message),
    `即使走完考勤追查，事故时未生效的保险依旧不可改赔：${attForceApprove.body.message}`);
  const attReject = await req('POST', `/api/claims/${cAtt.id}/adjust`, tSupport, { approve: false, note: '事故时保险未生效，保险拒赔，转企业责任追偿' });
  ok(attReject.body.claim.status === 'REJECTED', '保险核定拒赔，转企业责任跟进');
  // 医疗垫付单独记账
  const attAdvance = await req('POST', `/api/claims/${cAtt.id}/medical-advance`, tSupport, { amount: 1200, by: 'PLATFORM', note: '平台先垫付腰伤诊疗费' });
  ok(Number(attAdvance.body.claim.medicalAdvanceAmount) === 1200, '医疗垫付 ¥1200 单独跟进，与工资互不冲抵');
  // 责任判定
  const attLiab = await req('POST', `/api/claims/${cAtt.id}/liability`, tSupport, {
    result: 'ENTERPRISE_LIABLE', note: '企业未按要求确认到岗导致保险未生效，结合企业自认管理疏漏，判定企业全责，垫付向企业追偿',
  });
  ok(attLiab.body.claim.liabilityResult === 'ENTERPRISE_LIABLE', '平台判定企业全责（考勤缺失举证不利）');
  // 未判定责任前不能结案；判定且工资已结后可以结案
  const beforeClose = (await req('GET', `/api/claims/${cAtt.id}`, tSupport)).body;
  ok(beforeClose.followUps.length >= 7, `周强理赔跟进时间线 ${beforeClose.followUps.length} 条，工资结清后事故仍被持续跟进`);
  const attClose = await req('POST', `/api/claims/${cAtt.id}/close`, tSupport, { note: '工资已按工时结算、企业承担医疗费用并向平台归还垫付，整件结案' });
  ok(attClose.status === 201 && attClose.body.claim.status === 'CLOSED' && !!attClose.body.claim.closedAt,
    '工资已结+责任判定+垫付有去向 → 工伤整件结案（CLOSED）');

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒烟测试异常中断：', e);
  process.exit(2);
});
