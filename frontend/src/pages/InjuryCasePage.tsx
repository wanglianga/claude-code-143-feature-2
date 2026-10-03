import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Badge, CaseStatusBadge, Field, Modal, Spinner, StatusBadge, fmtDateTime, fmtMoney,
} from '../components/ui';

const MATERIAL_ITEMS: { key: string; label: string }[] = [
  { key: 'accidentNotice', label: '事故说明/报案登记表' },
  { key: 'medicalRecord', label: '病历/诊断证明' },
  { key: 'receipts', label: '医疗票据' },
  { key: 'attendanceProof', label: '考勤/到岗证明' },
  { key: 'supervisorStatement', label: '主管情况说明' },
  { key: 'enterpriseOpinion', label: '企业责任意见' },
  { key: 'idCopy', label: '工人身份证/银行卡' },
];

const FOLLOW_TYPE_LABEL: Record<string, string> = {
  DOC_REQUIRED: '待补资料',
  DOC_SUBMITTED: '资料补充',
  HOSPITAL_RECEIPT: '医院补票',
  SUPERVISOR_NOTE: '主管说明',
  ENTERPRISE_OPINION: '企业责任意见',
  ATTENDANCE_TRACE: '考勤追查',
  ADVANCE: '医疗垫付',
  LIABILITY: '责任判定',
  INSURER: '保险反馈',
  STATUS: '案件进展',
};

const FOLLOW_TYPE_TONE: Record<string, any> = {
  DOC_REQUIRED: 'orange', HOSPITAL_RECEIPT: 'blue', ENTERPRISE_OPINION: 'purple',
  ATTENDANCE_TRACE: 'red', ADVANCE: 'orange', LIABILITY: 'red', INSURER: 'green',
};

export default function InjuryCasePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [c, setC] = useState<any>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const timer = useRef<any>(null);

  const load = async (silent = false) => {
    try { setC(await get(`/injuries/${id}`)); }
    catch (e: any) { if (!silent) setError(e.message); }
  };
  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 6000);
    return () => clearInterval(timer.current);
  }, [id]);

  const act = async (fn: () => Promise<any>, okMsg?: string) => {
    setError(''); setMsg('');
    try {
      const r = await fn();
      setMsg(r?.message || okMsg || '操作成功');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  if (!c) return <Spinner />;
  const isSupport = user?.role === 'SUPPORT';
  const isEntSide = user?.role === 'ENTERPRISE' || user?.role === 'SUPERVISOR';
  const isWorker = user?.role === 'WORKER';
  const closed = ['SETTLED', 'CLOSED'].includes(c.status);

  return (
    <div>
      <button className="btn btn-sm" onClick={() => nav(-1)}>← 返回</button>
      <div className="fab-space" />
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="ok">{msg}</Alert>}

      <div className="card">
        <div className="row">
          <Badge tone="red">工伤事件 #{c.id}</Badge>
          <b style={{ fontSize: 16 }}>{c.job.title}</b>
          <div className="spacer" />
          <CaseStatusBadge status={c.status} />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {c.enterprise.name} · 工人 {c.worker.name}（{c.worker.phone}）· 派单 #{c.assignmentId}
        </div>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div className="kv">
            <span className="k">事故时间</span><span>{fmtDateTime(c.occurredAt)}（服务器时间，不可补录）</span>
            <span className="k">事故岗位</span><span>{c.positionAtInjury}</span>
            <span className="k">伤情</span><span>{c.injuryDesc}</span>
            <span className="k">就医医院</span><span>{c.hospital || '未登记'}</span>
            <span className="k">医疗费用</span><span>{fmtMoney(c.medicalExpense)}</span>
          </div>
          <div className="kv">
            <span className="k">现场照片</span><span>{c.scenePhotos ? c.scenePhotos.split(',').map((p: string) => `📷 ${p}`).join('，') : '无'}</span>
            <span className="k">就医票据</span><span>{c.medicalReceipts ? c.medicalReceipts.split(',').map((p: string) => `🧾 ${p}`).join('，') : '无'}</span>
            <span className="k">主管确认</span>
            <span>{c.supervisorConfirmed
              ? <Badge tone="green">已确认（{c.supervisor?.name}，{fmtDateTime(c.confirmedAt)}）</Badge>
              : <Badge tone="orange">待主管确认</Badge>}</span>
            <span className="k">主管说明</span><span>{c.supervisorNote || '—'}</span>
          </div>
        </div>
      </div>

      {/* 保险状态 + 考勤缺失追查 */}
      <div className="card">
        <h2>保险生效状态 & 考勤追查</h2>
        <div className="row">
          {c.coveredAtOccurrence
            ? <Badge tone="green">事故时保险在保障期内（{c.policyStatusAtOccurrence}）</Badge>
            : <Badge tone="red">事故时保险未生效（{c.policyStatusAtOccurrence || '无保单'}）· 不可事后补录/改赔</Badge>}
          {c.policy && <span className="small muted">保单 #{c.policy.id} {c.policy.insurerProduct}，生效 {fmtDateTime(c.policy.effectiveFrom)}</span>}
          <div className="spacer" />
          {c.attendanceGap && <Badge tone="red">⚠️ 考勤缺失：{({
            PENDING: '平台追查中', CONFIRMED_ARRIVAL: '企业承认实际到岗未确认',
            NO_ARRIVAL: '认定未到岗', UNVERIFIABLE: '无法核实',
          } as any)[c.attendanceGapResult]}</Badge>}
        </div>
        {c.attendanceGapNote && <div className="small" style={{ marginTop: 6 }}>追查说明：{c.attendanceGapNote}</div>}
        {c.attendanceGap && c.attendanceGapResult === 'PENDING' && isSupport && (
          <GapTracePanel caseId={c.id} onAct={act} />
        )}
      </div>

      {/* 保险报案 + 资料清单 */}
      <div className="card">
        <h2>保险报案与理赔资料</h2>
        {!c.injuryClaimId ? (
          ['DRAFT', 'DISPUTED'].includes(c.status) ? (
            <Alert kind="warn">工伤事件尚待现场主管确认，确认后客服才能发起保险报案。</Alert>
          ) : (
            isSupport
              ? <FileReportPanel caseId={c.id} onAct={act} defaultAmount={Math.max(500, Number(c.medicalExpense) * 3 || 3000)} />
              : <Alert kind="info">等待平台客服根据工伤记录发起保险报案。</Alert>
          )
        ) : (
          <>
            <div className="row">
              <Badge tone="blue">报案号 {c.claim.insurerReportNo}</Badge>
              <StatusBadge status={c.claim.status} />
              <span className="small muted">报案时间 {fmtDateTime(c.claim.reportedAt)}</span>
              <div className="spacer" />
              <span className="small">索赔 {fmtMoney(c.claim.claimAmount)}
                {Number(c.claim.payoutAmount) > 0 && ` · 赔付 ${fmtMoney(c.claim.payoutAmount)}`}</span>
            </div>
            {!c.coveredAtOccurrence && (
              <Alert kind="error">保险公司拒赔：事故时保险未生效。医疗垫付与企业责任由平台另案跟进；
                若追查确认企业未按要求确认到岗，保险缺口由企业承担。</Alert>
            )}
            <h3 style={{ marginTop: 12 }}>理赔资料清单（持续跟踪）</h3>
            <div className="grid grid-2">
              {MATERIAL_ITEMS.map((m) => {
                const done = !!c.claim.materials?.[m.key];
                return (
                  <label key={m.key} className="row small" style={{ padding: '4px 0' }}>
                    <input
                      type="checkbox" checked={done} disabled={!isSupport || closed}
                      onChange={(e) => act(
                        () => post(`/injuries/${c.id}/materials`, { patch: { [m.key]: e.target.checked } }),
                        `资料「${m.label}」已${e.target.checked ? '收齐' : '标记待补'}`,
                      )}
                    />
                    <span style={{ marginLeft: 6 }}>{done ? '✅' : '⬜'} {m.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {c.missingMaterials.length ? `待补：${c.missingMaterials.join('、')}` : '资料已齐，等待保险审核'}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <Badge tone={c.claim.hospitalReceiptStatus === 'PENDING' ? 'orange' : 'green'}>
                医院补票：{c.claim.hospitalReceiptStatus === 'PENDING' ? '待补正式发票' : c.claim.hospitalReceiptStatus === 'SUPPLEMENTED' ? '已补票' : '无需补票'}
              </Badge>
              {c.claim.hospitalReceiptNote && <span className="small muted">{c.claim.hospitalReceiptNote}</span>}
              <div className="spacer" />
              {(isWorker || isSupport) && !closed && <HospitalReceiptPanel caseId={c.id} onAct={act} />}
            </div>
          </>
        )}
      </div>

      {/* 日结工资：先按已完成工时结算 */}
      <div className="card">
        <h2>日结工资（与医疗/责任分开处理）</h2>
        {c.settlement ? (
          <div className="row">
            <span className="small">已完成工时 {c.settlement.workMinutes} 分钟，应发 {fmtMoney(c.settlement.workerPayable)}</span>
            <StatusBadge status={c.settlement.status} />
            <div className="spacer" />
            {c.settlement.deductionReason && <span className="small muted">{c.settlement.deductionReason}</span>}
          </div>
        ) : (
          <Alert kind="info">尚未结算。工伤停工后日结工资先按事故前已完成工时结算，企业确认后正常发放；理赔不受工资结清影响。</Alert>
        )}
        {((isSupport || isEntSide) && (!c.settlement || !['PAID', 'ADJUSTED'].includes(c.settlement.status))) && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={closed}
              onClick={() => act(() => post(`/injuries/${c.id}/settle-wages`), '已按已完成工时生成/更新日结明细')}>
              按已完成工时生成日结
            </button>
            {c.settlement && user?.role === 'ENTERPRISE' && (
              <button className="btn btn-success btn-sm"
                onClick={() => act(() => post('/settlements/pay', { assignmentIds: [c.assignmentId] }), '日结工资已发放（理赔继续跟进）')}>
                确认发放日结
              </button>
            )}
          </div>
        )}
      </div>

      {/* 医疗垫付 */}
      <AdvancePanel c={c} isSupport={!!isSupport} isEntSide={isEntSide} closed={closed} onAct={act} />

      {/* 责任判定 */}
      <div className="card">
        <h2>责任判定（单独跟进）</h2>
        <div className="row">
          <Badge tone={c.liability === 'PENDING' ? 'orange' : 'red'}>
            {({ PENDING: '待判定', ENTERPRISE: '企业全责', WORKER: '工人自身原因', THIRD_PARTY: '第三方责任', JOINT: '多方分担' } as any)[c.liability]}
            {c.liability === 'JOINT' && ` · 企业 ${c.enterpriseLiabilityPct}%`}
          </Badge>
          {c.liabilityDecidedAt && <span className="small muted">判定时间 {fmtDateTime(c.liabilityDecidedAt)}</span>}
        </div>
        {c.liabilityNote && <div className="small" style={{ marginTop: 6 }}>判定依据：{c.liabilityNote}</div>}
        <div style={{ marginTop: 8 }}>
          {c.enterpriseOpinion
            ? <Alert kind="info">企业责任意见（{fmtDateTime(c.enterpriseOpinionAt)}）：{c.enterpriseOpinion}</Alert>
            : (isEntSide && !closed
              ? <EnterpriseOpinionPanel caseId={c.id} onAct={act} />
              : <span className="small muted">企业尚未提交责任意见</span>)}
        </div>
        {isSupport && !closed && <LiabilityPanel caseId={c.id} onAct={act} />}
      </div>

      {/* 跟进时间线 */}
      <div className="card">
        <h2>跟进记录（{c.followups.length}）—— 工资结清后仍持续跟踪</h2>
        <div className="timeline">
          {c.followups.map((f: any) => (
            <div key={f.id} className="t-item">
              <div className="row">
                <Badge tone={FOLLOW_TYPE_TONE[f.type] || 'gray'}>{FOLLOW_TYPE_LABEL[f.type] || f.type}</Badge>
                <b>{f.actorName || f.actorRole}</b>
                <div className="spacer" />
                <span className="small muted">{fmtDateTime(f.createdAt)}</span>
              </div>
              <div className="small" style={{ marginTop: 4 }}>{f.content}</div>
              {f.attachments && <div className="small">📎 {f.attachments.split(',').join('，')}</div>}
              {f.amount != null && <div className="small money">金额：{fmtMoney(f.amount)}</div>}
            </div>
          ))}
        </div>
        {!closed && <FollowupCompose caseId={c.id} role={user?.role} isSupport={!!isSupport} isEntSide={isEntSide} isWorker={!!isWorker} onAct={act} />}
      </div>

      {/* 结案 */}
      {isSupport && !closed && <ClosePanel c={c} onAct={act} />}
      {closed && (
        <div className="card">
          <Alert kind="ok">案件已于 {fmtDateTime(c.closedAt)} 结案：{c.closeNote || '无备注'}
            {Number(c.insurancePayout) > 0 && ` · 保险赔付 ${fmtMoney(c.insurancePayout)}`}</Alert>
        </div>
      )}
    </div>
  );
}

/* ---------------- 子面板 ---------------- */

function FileReportPanel({ caseId, onAct, defaultAmount }: { caseId: number; onAct: any; defaultAmount: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(defaultAmount);
  const [note, setNote] = useState('');
  if (!open) return <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>客服发起保险报案</button>;
  return (
    <div>
      <Alert kind="warn">报案后平台持续跟踪理赔资料、医院补票与企业责任意见；事故时未生效的保单保险拒赔且不可改赔。</Alert>
      <div className="grid grid-2">
        <Field label="预估索赔金额（元）"><input className="input" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        <Field label="报案备注"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" /></Field>
      </div>
      <div className="row">
        <div className="spacer" />
        <button className="btn" onClick={() => setOpen(false)}>取消</button>
        <button className="btn btn-success" onClick={() => onAct(
          () => post(`/injuries/${caseId}/report-insurance`, { claimAmount: amount, note }),
          '保险报案已提交，进入理赔跟进',
        ).then(() => setOpen(false))}>提交报案</button>
      </div>
    </div>
  );
}

function GapTracePanel({ caseId, onAct }: { caseId: number; onAct: any }) {
  const [result, setResult] = useState('CONFIRMED_ARRIVAL');
  const [note, setNote] = useState('');
  return (
    <div style={{ marginTop: 10 }}>
      <Alert kind="warn">企业未按要求确认到岗导致考勤缺失：追查结论将影响理赔——企业承认实际到岗的，保险缺口由企业承担。</Alert>
      <div className="grid grid-2">
        <Field label="追查结论">
          <select className="input" value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="CONFIRMED_ARRIVAL">企业承认工人实际到岗（未确认）→ 企业承担保险缺口</option>
            <option value="NO_ARRIVAL">认定工人未到岗</option>
            <option value="UNVERIFIABLE">无法核实</option>
          </select>
        </Field>
        <Field label="核查说明"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <button className="btn btn-danger btn-sm" onClick={() => onAct(
        () => post(`/injuries/${caseId}/attendance-gap`, { result, note }), '考勤缺失追查结论已记录')}>
        提交追查结论
      </button>
    </div>
  );
}

function HospitalReceiptPanel({ caseId, onAct }: { caseId: string; onAct: any }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('医院补开正式发票');
  if (!open) return <button className="btn btn-sm" onClick={() => setOpen(true)}>上传/登记医院补票</button>;
  return (
    <span className="row" style={{ gap: 6 }}>
      <input className="input" style={{ width: 90 }} type="number" placeholder="金额" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} />
      <input className="input" style={{ width: 200 }} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-primary btn-sm" onClick={() => onAct(
        () => post(`/injuries/${caseId}/followups`, {
          type: 'HOSPITAL_RECEIPT', content: note, amount,
          attachments: `seed://hospital-invoice-${Date.now()}`,
        }), '医院补票已登记，医疗票据资料更新为已收').then(() => setOpen(false))}>提交补票</button>
      <button className="btn btn-sm" onClick={() => setOpen(false)}>取消</button>
    </span>
  );
}

function AdvancePanel({ c, isSupport, isEntSide, closed, onAct }: any) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('ENTERPRISE');
  const [amount, setAmount] = useState(500);
  const [note, setNote] = useState('');
  return (
    <div className="card">
      <h2>医疗垫付（独立记账，不走工资）</h2>
      <div className="row">
        <Badge tone={c.advanceSource === 'NONE' ? 'gray' : 'orange'}>
          {({ NONE: '暂无垫付', ENTERPRISE: '企业垫付', PLATFORM: '平台先行垫付', WORKER_SELF: '工人自行支付' } as any)[c.advanceSource]}
          {' '}{fmtMoney(c.advanceAmount)}
        </Badge>
        {c.advanceRecoveryStatus !== 'N_A' && (
          <Badge tone={c.advanceRecoveryStatus === 'PENDING' ? 'orange' : 'green'}>
            追回：{c.advanceRecoveryStatus === 'PENDING' ? '待理赔款抵扣/追回' : c.advanceRecoveryStatus === 'RECOVERED' ? '已抵扣返还' : '已免除'}
          </Badge>
        )}
        {c.advanceNote && <span className="small muted">{c.advanceNote}</span>}
        <div className="spacer" />
        {(isSupport || isEntSide) && !closed && <button className="btn btn-sm" onClick={() => setOpen(!open)}>登记垫付</button>}
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="grid grid-3">
            <Field label="垫付来源">
              <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="ENTERPRISE">企业垫付</option>
                <option value="PLATFORM">平台先行垫付</option>
                <option value="WORKER_SELF">工人自行支付（登记备查）</option>
              </select>
            </Field>
            <Field label="金额（元）"><input className="input" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
            <Field label="说明"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => onAct(
            () => post(`/injuries/${c.id}/advance`, { source, amount, note }), '医疗垫付已登记').then(() => setOpen(false))}>
            提交垫付登记
          </button>
        </div>
      )}
      {isSupport && c.advanceRecoveryStatus === 'PENDING' && !closed && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn-success btn-sm" onClick={() => onAct(
            () => post(`/injuries/${c.id}/advance/resolve`, { status: 'RECOVERED', note: '理赔到账抵扣' }), '垫付已由理赔款抵扣返还')}>
            理赔款抵扣返还
          </button>
          <button className="btn btn-sm" onClick={() => onAct(
            () => post(`/injuries/${c.id}/advance/resolve`, { status: 'WAIVED', note: '平台核定免除' }), '垫付已免除')}>
            免除追回
          </button>
        </div>
      )}
    </div>
  );
}

function EnterpriseOpinionPanel({ caseId, onAct }: { caseId: number; onAct: any }) {
  const [open, setOpen] = useState(false);
  const [opinion, setOpinion] = useState('');
  const [pct, setPct] = useState(100);
  if (!open) return <button className="btn btn-sm" onClick={() => setOpen(true)}>提交企业责任意见</button>;
  return (
    <div>
      <Field label={`企业意见（自认承担比例 ${pct}%）`}>
        <textarea className="input" rows={2} value={opinion} onChange={(e) => setOpinion(e.target.value)}
          placeholder="如：现场线缆防护不足，企业认可主要责任…" />
      </Field>
      <div className="row">
        <input type="range" min={0} max={100} step={10} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => setOpen(false)}>取消</button>
        <button className="btn btn-primary btn-sm" onClick={() => onAct(
          () => post(`/injuries/${caseId}/enterprise-opinion`, { opinion, acceptedPct: pct }),
          '企业责任意见已提交').then(() => setOpen(false))}>提交</button>
      </div>
    </div>
  );
}

function LiabilityPanel({ caseId, onAct }: { caseId: number; onAct: any }) {
  const [open, setOpen] = useState(false);
  const [liability, setLiability] = useState('ENTERPRISE');
  const [pct, setPct] = useState(50);
  const [note, setNote] = useState('');
  if (!open) return <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>平台进行责任判定</button>;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="grid grid-2">
        <Field label="责任类型">
          <select className="input" value={liability} onChange={(e) => setLiability(e.target.value)}>
            <option value="ENTERPRISE">企业全责</option>
            <option value="JOINT">多方分担</option>
            <option value="WORKER">工人自身原因</option>
            <option value="THIRD_PARTY">第三方责任（场馆/甲方）</option>
          </select>
        </Field>
        {liability === 'JOINT' && (
          <Field label={`企业承担比例 ${pct}%`}><input type="range" min={0} max={100} step={10} value={pct} onChange={(e) => setPct(Number(e.target.value))} /></Field>
        )}
      </div>
      <Field label="判定依据"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="row">
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => setOpen(false)}>取消</button>
        <button className="btn btn-danger btn-sm" onClick={() => onAct(
          () => post(`/injuries/${caseId}/liability`, { liability, enterprisePct: pct, note }),
          '责任判定已记录').then(() => setOpen(false))}>提交判定</button>
      </div>
    </div>
  );
}

function FollowupCompose({ caseId, role, isSupport, isEntSide, isWorker, onAct }: any) {
  const options: [string, string][] = [
    ['DOC_SUBMITTED', '补充理赔资料'],
    ...(isWorker ? [['HOSPITAL_RECEIPT', '医院补票']] as [string, string][] : []),
    ...(role === 'ENTERPRISE' ? [['ENTERPRISE_OPINION', '企业责任意见']] as [string, string][] : []),
    ...(isSupport ? [
      ['DOC_REQUIRED', '登记待补资料'],
      ['HOSPITAL_RECEIPT', '医院补票跟进'],
      ['ATTENDANCE_TRACE', '考勤追查'],
      ['ADVANCE', '垫付跟进'],
      ['LIABILITY', '责任跟进'],
      ['INSURER', '保险公司反馈'],
      ['STATUS', '案件进展备注'],
    ] as [string, string][] : []),
  ];
  const [type, setType] = useState(options[0][0]);
  const [content, setContent] = useState('');
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <select className="input" style={{ width: 150 }} value={type} onChange={(e) => setType(e.target.value)}>
        {options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <input className="input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="填写跟进内容…"
        onKeyDown={(e) => e.key === 'Enter' && content.trim() && onAct(
          () => post(`/injuries/${caseId}/followups`, { type, content }), '跟进已记录').then(() => setContent(''))} />
      <button className="btn btn-primary btn-sm" disabled={!content.trim()} onClick={() => onAct(
        () => post(`/injuries/${caseId}/followups`, { type, content }), '跟进已记录').then(() => setContent(''))}>
        添加跟进
      </button>
    </div>
  );
}

function ClosePanel({ c, onAct }: any) {
  const [open, setOpen] = useState(false);
  const [payout, setPayout] = useState(Number(c.claim?.claimAmount) || 0);
  const [note, setNote] = useState('');
  return (
    <div className="card">
      <h2>结案</h2>
      {!open ? (
        <button className="btn btn-warn" onClick={() => setOpen(true)}>理赔结案 / 关闭案件</button>
      ) : (
        <div>
          {c.coveredAtOccurrence
            ? <Field label={`保险最终赔付金额（元）：${payout}`}><input type="range" min={0} max={Math.max(5000, Number(c.claim?.claimAmount) || 0)} step={100} value={payout} onChange={(e) => setPayout(Number(e.target.value))} /></Field>
            : <Alert kind="warn">事故时保险未生效，不能以保险赔付结案；企业责任/垫付履行完毕后可关闭案件。</Alert>}
          <Field label="结案说明"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row">
            <div className="spacer" />
            <button className="btn btn-sm" onClick={() => setOpen(false)}>取消</button>
            {c.coveredAtOccurrence
              ? <button className="btn btn-success" onClick={() => onAct(
                () => post(`/injuries/${c.id}/close`, { outcome: 'SETTLED', payoutAmount: payout, note }), '理赔已结案').then(() => setOpen(false))}>
                确认理赔结案
              </button>
              : <button className="btn btn-primary" onClick={() => onAct(
                () => post(`/injuries/${c.id}/close`, { outcome: 'CLOSED', note }), '案件已关闭').then(() => setOpen(false))}>
                关闭案件
              </button>}
          </div>
        </div>
      )}
    </div>
  );
}
