import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Badge, ClaimStatusBadge, Field, Modal, Spinner, StatusBadge, fmtDateTime, fmtMoney,
} from '../components/ui';

const FOLLOW_LABEL: Record<string, string> = {
  RECORD: '事故记录', SUPERVISOR_CONFIRM: '主管确认', REPORT: '保险报案',
  MATERIAL: '理赔资料', RECEIPT: '医院补票', MEDICAL_ADVANCE: '医疗垫付',
  ATTENDANCE_CHECK: '考勤追查', ENTERPRISE_OPINION: '企业责任意见', LIABILITY: '责任判定',
  ADJUST: '保险核定', WAGE_SETTLED: '工资结算', NOTE: '跟进备注', CLOSE: '结案',
};
const FOLLOW_TONE: Record<string, any> = {
  RECORD: 'blue', SUPERVISOR_CONFIRM: 'green', REPORT: 'orange', MATERIAL: 'purple',
  RECEIPT: 'purple', MEDICAL_ADVANCE: 'orange', ATTENDANCE_CHECK: 'red',
  ENTERPRISE_OPINION: 'blue', LIABILITY: 'red', ADJUST: 'green',
  WAGE_SETTLED: 'green', NOTE: 'gray', CLOSE: 'gray',
};
const LIABILITY_LABEL: Record<string, string> = {
  PENDING: '待判定', ENTERPRISE_LIABLE: '企业全责', WORKER_LIABLE: '工人自身原因',
  SHARED: '双方分担', NO_LIABILITY: '意外无责',
};
const LIABILITY_TONE: Record<string, any> = {
  PENDING: 'orange', ENTERPRISE_LIABLE: 'red', WORKER_LIABLE: 'gray', SHARED: 'orange', NO_LIABILITY: 'blue',
};

export default function ClaimDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [action, setAction] = useState('');

  const role = user?.role;
  const isSupport = role === 'SUPPORT';
  const isEnterprise = role === 'ENTERPRISE' || role === 'SUPERVISOR';
  const isWorker = role === 'WORKER';

  const load = async (silent = false) => {
    try { setData(await get(`/claims/${id}`)); } catch (e: any) { if (!silent) setError(e.message); }
  };
  useEffect(() => { load(); const t = setInterval(() => load(true), 6000); return () => clearInterval(t); }, [id]);

  const act = async (path: string, body: any, ok: string) => {
    setError(''); setMsg('');
    try {
      await post(path, body);
      setMsg(ok);
      setAction('');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  if (!data) return <Spinner />;
  const c = data.claim;
  const p = data.policy;
  const att = data.attendanceAnalysis;
  const s = data.settlement;

  const photos: string[] = c.scenePhotos || [];
  const receipts: string[] = c.medicalReceipts || [];

  return (
    <div>
      <button className="btn btn-sm" onClick={() => nav(-1)}>← 返回</button>
      <div className="fab-space" />
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="ok">{msg}</Alert>}

      <div className="card">
        <div className="row">
          <Badge tone="red">工伤理赔 #{c.id}</Badge>
          <b style={{ fontSize: 16 }}>{c.jobTitle}</b>
          <div className="spacer" />
          <ClaimStatusBadge status={c.status} />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {c.enterpriseName} · 工人 {c.workerName}（{c.workerPhone}）· 派单 #{c.assignmentId} · 作业事件 #{c.jobEventId}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {c.coveredAtOccurrence
            ? <Badge tone="green">事故时保险在保障期内</Badge>
            : <Badge tone="red">事故时保险未生效·保险不可赔（禁止事后补录）</Badge>}
          <Badge tone={LIABILITY_TONE[c.liabilityResult]}>责任：{LIABILITY_LABEL[c.liabilityResult]}</Badge>
          {c.reportedToInsurer && <Badge tone="orange">已报案 {c.insurerReportNo}</Badge>}
          {c.materialsComplete && <Badge tone="purple">资料齐套</Badge>}
        </div>
      </div>

      {/* 事故六要素 */}
      <div className="card">
        <h2>事故记录（现场固化，时间不可篡改）</h2>
        <div className="grid grid-2">
          <div className="kv">
            <span className="k">事故时间</span><span>{fmtDateTime(c.accidentAt)}（服务器时间）</span>
            <span className="k">受伤岗位</span><span>{c.workPosition || '—'}</span>
            <span className="k">伤情描述</span><span>{c.injuryDesc}</span>
            <span className="k">预估索赔</span><span className="money">{fmtMoney(c.claimAmount)}</span>
          </div>
          <div className="kv">
            <span className="k">主管确认</span>
            <span>{c.supervisorConfirmed
              ? <Badge tone="green">已确认（{fmtDateTime(c.supervisorConfirmedAt)}）</Badge>
              : <Badge tone="orange">主管尚未确认工伤事实</Badge>}</span>
            {c.supervisorNote && <><span className="k">主管备注</span><span>{c.supervisorNote}</span></>}
            <span className="k">现场照片</span>
            <span>{photos.length
              ? photos.map((u, i) => <span key={u} className="badge badge-blue" style={{ marginRight: 4 }}>📷 现场{i + 1}</span>)
              : '无'}</span>
            <span className="k">就医票据</span>
            <span>{receipts.length
              ? receipts.map((u, i) => <span key={u} className="badge badge-purple" style={{ marginRight: 4 }}>🧾 票据{i + 1}</span>)
              : <span className="muted">待补票</span>}</span>
          </div>
        </div>
      </div>

      {/* 考勤缺失追查 */}
      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>考勤链与到岗确认追查</h2>
          <div className="spacer" />
          {att.issue ? <Badge tone="red">考勤缺失·影响理赔</Badge> : <Badge tone="green">四重考勤完整</Badge>}
        </div>
        <div className="small" style={{ marginTop: 6 }}>{att.conclusion}</div>
        {att.issues?.map((x: string, i: number) => (
          <div key={i} className="small" style={{ color: 'var(--red)' }}>⚠️ {x}</div>
        ))}
        {c.attendanceNote && <div className="small muted" style={{ marginTop: 6 }}>追查记录：{c.attendanceNote}（{fmtDateTime(c.attendanceCheckedAt)}）</div>}
        {p && (
          <div className="small muted" style={{ marginTop: 6 }}>
            保单：{p.insurerProduct} · 状态 {p.status} · 生效 {p.effectiveFrom ? fmtDateTime(p.effectiveFrom) : '未生效'}
            {p.activatedByAttendanceId ? ` · 锚定签到 #${p.activatedByAttendanceId}` : ''}
          </div>
        )}
        {isSupport && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm btn-danger" onClick={() => setAction('attendance')}>追查考勤缺失影响</button>
          </div>
        )}
      </div>

      {/* 日结工资先行结算 */}
      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>日结工资（按已完成工时先行结算）</h2>
          <div className="spacer" />
          {s ? <StatusBadge status={s.status} /> : <Badge tone="orange">尚未结算</Badge>}
        </div>
        {s ? (
          <div className="small" style={{ marginTop: 6 }}>
            已完成工时 {s.workMinutes} 分钟（迟到扣 {s.lateMinutes} 分钟、加班 {s.overtimeMinutes} 分钟）·
            工人应发 <b className="money">{fmtMoney(s.workerPayable)}</b>
            {s.deductionReason && <div className="muted">说明：{s.deductionReason}</div>}
          </div>
        ) : (
          <div className="small muted" style={{ marginTop: 6 }}>
            工人因伤无法继续作业，工资先按「到岗至事故」已完成工时结算；医疗垫付与责任判定单独跟进，不因工资结清而关单。
          </div>
        )}
        {isSupport && (!s || (s.status !== 'PAID' && s.status !== 'ADJUSTED')) && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm btn-success" onClick={() => act(`/claims/${c.id}/settle-wage`, {}, '已按已完成工时生成日结明细，等待企业发放')}>
              按已完成工时先行结算工资
            </button>
            {s && (
              <button className="btn btn-sm" onClick={() => nav(`/room/${c.assignmentId}`)}>去任务室通知企业发放</button>
            )}
          </div>
        )}
      </div>

      {/* 医疗垫付 + 责任判定 */}
      <div className="grid grid-2">
        <div className="card">
          <h2>医疗垫付（单独跟进）</h2>
          <div className="kv">
            <span className="k">累计垫付</span><span className="money">{fmtMoney(c.medicalAdvanceAmount)}</span>
            <span className="k">垫付方</span>
            <span>{({ PLATFORM: '平台', ENTERPRISE: '企业', INSURER: '保险预付' } as any)[c.medicalAdvanceBy] || '—'}</span>
            {c.medicalAdvanceAt && <><span className="k">垫付时间</span><span>{fmtDateTime(c.medicalAdvanceAt)}</span></>}
            {c.medicalAdvanceNote && <><span className="k">说明</span><span>{c.medicalAdvanceNote}</span></>}
          </div>
          {isSupport && <button className="btn btn-sm btn-warn" onClick={() => setAction('advance')}>登记医疗垫付</button>}
        </div>

        <div className="card">
          <h2>责任判定（单独跟进）</h2>
          <div className="kv">
            <span className="k">判定结论</span><span><Badge tone={LIABILITY_TONE[c.liabilityResult]}>{LIABILITY_LABEL[c.liabilityResult]}</Badge></span>
            {c.enterpriseOpinion && <><span className="k">企业意见</span><span>{c.enterpriseOpinion}（{fmtDateTime(c.enterpriseOpinionAt)}）</span></>}
            {c.liabilityNote && <><span className="k">判定依据</span><span>{c.liabilityNote}（{fmtDateTime(c.liabilityDecidedAt)}）</span></>}
          </div>
          {isEnterprise && (!c.enterpriseOpinion || c.liabilityResult === 'PENDING') && (
            <button className="btn btn-sm" onClick={() => setAction('opinion')}>提交/补充企业责任意见</button>
          )}
          {isSupport && <button className="btn btn-sm btn-danger" onClick={() => setAction('liability')}>平台责任判定</button>}
        </div>
      </div>

      {/* 操作按钮 */}
      {isSupport && (
        <div className="card">
          <h2>客服理赔操作</h2>
          <div className="risk-pills">
            {!c.reportedToInsurer && (
              <button className="btn btn-primary btn-sm"
                onClick={() => setAction('report')}>
                发起保险报案{!c.supervisorConfirmed ? '（主管未确认·平台核实）' : ''}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setAction('materials')}>理赔资料/医院补票</button>
            <button className="btn btn-sm" onClick={() => setAction('note')}>追加跟进备注</button>
            {c.status !== 'APPROVED' && c.status !== 'REJECTED' && c.status !== 'CLOSED' && (
              <>
                <button className="btn btn-sm btn-success" disabled={!c.reportedToInsurer || !c.coveredAtOccurrence}
                  title={!c.coveredAtOccurrence ? '事故时保险未生效，不可赔付（禁止事后补录）' : ''}
                  onClick={() => setAction('approve')}>保险核定赔付</button>
                <button className="btn btn-sm btn-danger" disabled={!c.reportedToInsurer}
                  onClick={() => act(`/claims/${c.id}/adjust`, { approve: false, note: '保险核定：不在保障范围' }, '已登记保险拒赔')}>
                  保险拒赔
                </button>
              </>
            )}
            {c.status !== 'CLOSED' && (
              <button className="btn btn-sm" onClick={() => setAction('close')}>整件结案</button>
            )}
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            铁律：事故时点 <code>coveredAtOccurrence=false</code> 的保单，任何角色都无法改为保险赔付；
            未报案不能直接核定赔付；工资结清不代表事故结案，资料/补票/垫付/责任须持续跟进。
          </div>
        </div>
      )}

      {isWorker && (
        <div className="card">
          <h2>工人补充材料</h2>
          <div className="small muted">治疗结束后可继续补交医院挂号/检查/药品票据，客服会持续跟进，不会因工资已结而无人处理。</div>
          <div className="fab-space" />
          <button className="btn btn-primary btn-sm" onClick={() => setAction('receipts')}>补交就医票据</button>
        </div>
      )}

      {/* 跟进时间线 */}
      <div className="card">
        <h2>理赔跟进时间线（{data.followUps.length}）</h2>
        <div className="timeline">
          {data.followUps.map((f: any) => (
            <div key={f.id} className="t-item">
              <div className="row">
                <Badge tone={FOLLOW_TONE[f.type] || 'gray'}>{FOLLOW_LABEL[f.type] || f.type}</Badge>
                <b>{f.operatorName}</b>
                <div className="spacer" />
                <span className="small muted">{fmtDateTime(f.createdAt)}</span>
              </div>
              <div className="small" style={{ marginTop: 4 }}>{f.content}</div>
              {f.attachmentUrls && <div className="small">{f.attachmentUrls.split(',').map((u: string, i: number) => (
                <span key={u} className="badge badge-purple" style={{ marginRight: 4 }}>📎 附件{i + 1}</span>
              ))}</div>}
              {f.nextAction && <div className="small" style={{ color: 'var(--orange)' }}>下一步：{f.nextAction}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ---------- 操作弹窗 ---------- */}
      {action === 'report' && (
        <ActionModal title="发起保险报案" onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/report`,
            { insurerReportNo: v.no, note: v.note, platformVerified: v.verified },
            '已向保险公司报案')}>
          {!c.supervisorConfirmed && (
            <Alert kind="error">
              主管尚未确认工伤事实。平台核实代报案须先完成「考勤缺失追查」；本次报案仅作留档，
              事故时保险未生效，保险预计拒赔，工资/医疗垫付/责任须单独跟进。
            </Alert>
          )}
          <Field label="保险报案号（留空自动生成）"><input className="input" name="no" placeholder="如 PICC20261003001" /></Field>
          <NoteField />
          {!c.supervisorConfirmed && (
            <label className="row small"><input type="checkbox" name="verified"
              defaultChecked={!!c.attendanceCheckedAt} disabled={!c.attendanceCheckedAt} />
              我已完成考勤缺失追查，平台核实后代为立案{!c.attendanceCheckedAt && '（请先执行考勤追查）'}
            </label>
          )}
        </ActionModal>
      )}
      {action === 'materials' && (
        <MaterialsModal c={c} onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/materials`, v, v.complete ? '资料已标记齐套，转入理赔核定' : '已登记资料待补，继续催补医院票据')} />
      )}
      {action === 'advance' && (
        <AdvanceModal onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/medical-advance`, v, '医疗垫付已登记（与工资分开跟进）')} />
      )}
      {action === 'attendance' && (
        <ActionModal title="追查考勤缺失对理赔的影响" onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/attendance-check`,
            { note: v.note, enterpriseAtFault: v.fault, recognizeArrival: v.arrival },
            '考勤追查结论已记录')}>
          <Alert kind="warn">系统考勤分析：{att.conclusion}</Alert>
          <Field label="追查结论（企业未确认到岗如何影响理赔/举证）">
            <textarea className="input" name="note" rows={3} defaultValue="企业主管未在系统确认工人实际到岗，导致保险未在事故前生效，企业承担举证不利后果" />
          </Field>
          <label className="row small"><input type="checkbox" name="fault" defaultChecked={att.issue} /> 认定企业未按要求确认到岗（责任判定举证不利）</label>
          <label className="row small"><input type="checkbox" name="arrival" />
            依据三要素/现场证据事后认定工人实际到岗（仅用于按工时结算工资与责任认定，<b>保险生效时间不追溯</b>）
          </label>
        </ActionModal>
      )}
      {action === 'liability' && (
        <LiabilityModal onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/liability`, v, '责任判定已记录')} />
      )}
      {action === 'approve' && (
        <ActionModal title="保险核定赔付" onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/adjust`, { approve: true, note: v.note }, '保险核定赔付已登记')}>
          <Alert kind="warn">仅当事故时保险在保障期内且资料齐套才可核定赔付，金额以保险公司核定为准。</Alert>
          <NoteField label="核定依据与赔付金额说明" text={`核定赔付 ${fmtMoney(c.claimAmount)}，资料齐套，属于保险责任`} />
        </ActionModal>
      )}
      {action === 'note' && (
        <ActionModal title="追加跟进备注" onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/notes`, { content: v.note, nextAction: v.next }, '备注已加入跟进时间线')}>
          <NoteField label="跟进内容" />
          <Field label="下一步待办（避免无人跟进）"><input className="input" name="next" placeholder="如：3 日内催工人补复查票据" /></Field>
        </ActionModal>
      )}
      {action === 'close' && (
        <ActionModal title="整件结案" onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/close`, { note: v.note }, '工伤理赔整件已结案')}>
          <Alert kind="warn">结案前须确认：工资已按工时结算、责任已判定、医疗垫付有明确去向。</Alert>
          <NoteField label="结案说明" text="工资已发放、保险赔付款到账、医疗垫付已向责任方追偿结清" />
        </ActionModal>
      )}
      {action === 'opinion' && (
        <ActionModal title="企业责任意见" onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/enterprise-opinion`, { opinion: v.note }, '企业责任意见已提交')}>
          <NoteField label="企业对事故经过与责任的意见（可多次补充）" />
        </ActionModal>
      )}
      {action === 'receipts' && (
        <ActionModal title="补交就医票据" onClose={() => setAction('')}
          onSubmit={(v) => act(`/claims/${c.id}/receipts`, { receiptUrls: v.urls, note: v.note }, '就医票据已补交，等待客服核验')}>
          <Alert kind="info">演示环境：填写票据占位标识（逗号分隔），如 mock://receipt-fuzen-1,mock://receipt-yaofei</Alert>
          <Field label="就医票据标识（逗号分隔）"><input className="input" name="urls" placeholder="mock://receipt-1,mock://receipt-2" /></Field>
          <NoteField label="票据说明" text="复查挂号费 + 药品费" />
        </ActionModal>
      )}
    </div>
  );
}

/* 通用表单弹窗：通过 name 收集字段 */
function ActionModal({ title, children, onClose, onSubmit }: {
  title: string; children: any; onClose: () => void;
  onSubmit: (v: Record<string, any>) => Promise<void> | void;
}) {
  const formSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const v: Record<string, any> = {};
    fd.forEach((val, key) => { v[key] = val; });
    // checkbox
    (e.target as HTMLFormElement).querySelectorAll('input[type=checkbox]').forEach((cb: any) => { v[cb.name] = cb.checked; });
    return onSubmit(v);
  };
  return (
    <Modal title={title} onClose={onClose}
      footer={<button type="submit" form="action-form" className="btn btn-primary">提交</button>}>
      <form id="action-form" onSubmit={formSubmit} className="col" style={{ gap: 10 }}>
        {children}
      </form>
    </Modal>
  );
}

function NoteField({ label = '备注说明', text = '' }: { label?: string; text?: string }) {
  return (
    <Field label={label}><textarea className="input" name="note" rows={3} defaultValue={text} /></Field>
  );
}

function MaterialsModal({ c, onClose, onSubmit }: { c: any; onClose: () => void; onSubmit: (v: any) => void }) {
  const [complete, setComplete] = useState(false);
  const [note, setNote] = useState('已核对病历/诊断证明/就医票据');
  const [urls, setUrls] = useState('');
  const [missing, setMissing] = useState('');
  return (
    <Modal title="理赔资料 / 医院补票跟进" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={() => onSubmit({ complete, note, receiptUrls: urls, missingItems: missing })}>提交</button>}>
      <Alert kind="info">现有就医票据 {c.medicalReceipts?.length || 0} 张。医院补票可由工人在其端补交，或在此登记。</Alert>
      <Field label="新增票据标识（逗号分隔）"><input className="input" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="mock://receipt-1" /></Field>
      <Field label="跟进说明"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {!complete && <Field label="尚缺资料"><input className="input" value={missing} onChange={(e) => setMissing(e.target.value)} placeholder="如：诊断证明、复查发票" /></Field>}
      <label className="row small"><input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} /> 资料已齐套（病历+诊断证明+票据齐全）</label>
    </Modal>
  );
}

function AdvanceModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (v: any) => void }) {
  const [amount, setAmount] = useState(1000);
  const [by, setBy] = useState<'PLATFORM' | 'ENTERPRISE' | 'INSURER'>('PLATFORM');
  const [note, setNote] = useState('凭就医票据先行垫付，后续向责任方/保险追偿');
  const [urls, setUrls] = useState('');
  return (
    <Modal title="登记医疗垫付" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={() => onSubmit({ amount, by, note, receiptUrls: urls })}>登记垫付</button>}>
      <Alert kind="warn">医疗垫付与日结工资分开记账、单独跟进，不冲抵工资。</Alert>
      <Field label="垫付金额（元）"><input className="input" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
      <Field label="垫付方">
        <select className="input" value={by} onChange={(e) => setBy(e.target.value as any)}>
          <option value="PLATFORM">平台先行垫付</option>
          <option value="ENTERPRISE">企业垫付</option>
          <option value="INSURER">保险预付</option>
        </select>
      </Field>
      <Field label="对应票据标识（逗号分隔）"><input className="input" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="mock://receipt-1" /></Field>
      <Field label="垫付说明"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

function LiabilityModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (v: any) => void }) {
  const [result, setResult] = useState('ENTERPRISE_LIABLE');
  const [note, setNote] = useState('');
  return (
    <Modal title="平台责任判定" onClose={onClose}
      footer={<button className="btn btn-primary" disabled={!note.trim()} onClick={() => onSubmit({ result, note })}>提交判定</button>}>
      <Alert kind="warn">责任判定与保险赔付相互独立：保险是否赔付看事故时保单是否生效；责任判定依据考勤、现场照片、企业意见等综合认定。</Alert>
      <Field label="责任结论">
        <select className="input" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="ENTERPRISE_LIABLE">企业全责（含未按要求确认到岗、现场管理缺失）</option>
          <option value="SHARED">双方分担</option>
          <option value="WORKER_LIABLE">工人自身原因</option>
          <option value="NO_LIABILITY">意外事件，无过错方</option>
        </select>
      </Field>
      <Field label="判定依据（考勤/照片/企业意见/聊天记录）">
        <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="如：企业主管未在系统确认实际到岗，结合现场照片与就医票据，企业承担举证不利后果…" />
      </Field>
    </Modal>
  );
}
