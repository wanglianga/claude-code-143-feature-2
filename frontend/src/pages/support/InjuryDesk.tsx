import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Alert, Badge, CaseStatusBadge, Spinner, fmtDateTime, fmtMoney } from '../../components/ui';

export default function InjuryDesk() {
  const [list, setList] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('OPEN');
  const timer = useRef<any>(null);

  const load = async (silent = false) => {
    try {
      const [rows, s] = await Promise.all([get('/support/injuries'), get('/support/injuries/stats')]);
      setList(rows); setStats(s);
    } finally { if (!silent) setLoading(false); }
  };
  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 8000);
    return () => clearInterval(timer.current);
  }, []);

  if (loading) return <Spinner />;

  const shown = list.filter((c) => filter === 'ALL'
    ? true
    : filter === 'OPEN'
      ? !['SETTLED', 'CLOSED'].includes(c.status)
      : c.status === filter);

  const stat = (n: number, label: string, tone: any, f: string) => (
    <button className="card stat-tile" onClick={() => setFilter(f)} style={{ textAlign: 'left', cursor: 'pointer' }}>
      <div style={{ fontSize: 26, fontWeight: 700 }} className={`text-${tone}`}>{n}</div>
      <div className="small muted">{label}</div>
    </button>
  );

  return (
    <div>
      <h1>工伤事件与保险报案</h1>
      <Alert kind="warn">
        平台持续跟踪每一起工伤：日结工资按已完成工时先行结清后，理赔资料、医院补票、企业责任意见仍须跟进到底。
        事故时保险未生效的案件不可改赔；企业未按要求确认到岗的，追查考勤缺失并由企业承担保险缺口。
      </Alert>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, margin: '12px 0' }}>
        {stat(stats.open, '跟进中案件', 'orange', 'OPEN')}
        {stat(stats.awaitingReport, '待客服报案', 'red', 'CONFIRMED')}
        {stat(stats.attendanceGapTracing, '考勤缺失追查中', 'red', 'OPEN')}
        {stat(stats.wagesPaidButOpen, '工资已结·事故未结', 'purple', 'OPEN')}
        {stat(stats.stale, '停滞超 48 小时', 'red', 'OPEN')}
        {stat(stats.pendingLiability, '责任待判定', 'orange', 'OPEN')}
      </div>

      <div className="row" style={{ margin: '8px 0' }}>
        {['OPEN', 'CONFIRMED', 'CLAIM_TRACKING', 'REPORTED', 'SETTLED', 'CLOSED', 'ALL'].map((f) => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`} onClick={() => setFilter(f)}>
            {({ OPEN: '跟进中', CONFIRMED: '待报案', CLAIM_TRACKING: '理赔跟进', REPORT: '已报案', REPORTED: '已报案未生效', SETTLED: '已结案', CLOSED: '已关闭', ALL: '全部' } as any)[f]}
          </button>
        ))}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>#</th><th>工人/企业/岗位</th><th>事故时间</th><th>状态</th><th>事故时保险</th>
              <th>考勤</th><th>垫付</th><th>责任</th><th>工资</th><th>待补资料</th><th>跟进</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} style={c.stale ? { background: '#fff4f4' } : undefined}>
                <td>{c.id}</td>
                <td className="small">
                  <b>{c.workerName}</b> / {c.enterpriseName}<br />
                  <span className="muted">{c.jobTitle} · 派单#{c.assignmentId}</span>
                </td>
                <td className="small">{fmtDateTime(c.occurredAt)}</td>
                <td><CaseStatusBadge status={c.status} />{c.stale && <Badge tone="red">停滞</Badge>}</td>
                <td>{c.coveredAtOccurrence ? <Badge tone="green">保障期内</Badge> : <Badge tone="red">未生效</Badge>}
                  {c.claimStatus && <div className="small muted">{({
                    REPORTED: '已报案', WAITING_DOCS: '待补资料', DOCS_SUBMITTED: '资料待审核',
                    APPROVED: '已赔付', REJECTED: '保险拒赔', INVESTIGATING: '调查中',
                  } as any)[c.claimStatus]}</div>}
                </td>
                <td>{c.attendanceGap
                  ? <Badge tone={c.attendanceGapResult === 'PENDING' ? 'red' : 'orange'}>
                    {({ PENDING: '缺失追查中', CONFIRMED_ARRIVAL: '承认到岗', NO_ARRIVAL: '未到岗', UNVERIFIABLE: '无法核实' } as any)[c.attendanceGapResult]}
                  </Badge>
                  : <Badge tone="green">考勤正常</Badge>}</td>
                <td className="small">{c.advanceSource === 'NONE' || c.advanceSource == null ? '—'
                  : `${({ ENTERPRISE: '企业', PLATFORM: '平台', WORKER_SELF: '工人自付' } as any)[c.advanceSource]} ${fmtMoney(c.advanceAmount)}`}</td>
                <td>{({ PENDING: '待判定', ENTERPRISE: '企业全责', WORKER: '工人', THIRD_PARTY: '第三方', JOINT: `分担${c.enterpriseLiabilityPct}%` } as any)[c.liability]}</td>
                <td>{c.settlementStatus
                  ? <Badge tone={c.settlementPaid ? 'green' : 'orange'}>{c.settlementPaid ? '已发放' : '待发放'}</Badge>
                  : <span className="muted small">未结算</span>}</td>
                <td className="small">{c.missingMaterials.length
                  ? <span style={{ color: 'var(--red)' }}>{c.missingMaterials.slice(0, 2).join('、')}{c.missingMaterials.length > 2 ? ` +${c.missingMaterials.length - 2}` : ''}</span>
                  : (c.injuryClaimId ? <Badge tone="green">资料齐</Badge> : '—')}</td>
                <td className="small muted">{fmtDateTime(c.lastFollowupAt)}</td>
                <td><Link className="btn btn-sm btn-primary" to={`/injuries/${c.id}`}>处理</Link></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={12} className="muted">暂无案件</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
