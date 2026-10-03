import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Alert, Badge, CaseStatusBadge, Spinner, fmtDateTime, fmtMoney } from '../../components/ui';

export function InjuryList({ endpoint, title, scope }: { endpoint: string; title: string; scope: 'WORKER' | 'ENTERPRISE' }) {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<any>(null);

  const load = async (silent = false) => {
    try { setList(await get(endpoint)); } finally { if (!silent) setLoading(false); }
  };
  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 8000);
    return () => clearInterval(timer.current);
  }, [endpoint]);

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>{title}</h1>
      <Alert kind="info">
        规则：工伤事故由工人现场实时记录（事故时间不可补录），主管确认后由客服发起保险报案；
        日结工资先按事故前已完成工时结清，医疗垫付与责任判定单独跟进、不受工资结清影响。
      </Alert>
      <div className="card">
        {list.length === 0 && <div className="muted">暂无工伤记录</div>}
        {list.map((c) => (
          <div key={c.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row">
              <Badge tone="red">工伤 #{c.id}</Badge>
              <b>{scope === 'WORKER' ? c.jobTitle : `${c.workerName} · ${c.jobTitle}`}</b>
              <CaseStatusBadge status={c.status} />
              {c.stale && !['SETTLED', 'CLOSED'].includes(c.status) && <Badge tone="red">跟进停滞</Badge>}
              <div className="spacer" />
              <span className="small muted">{fmtDateTime(c.occurredAt)}</span>
              <Link className="btn btn-sm btn-primary" to={`/injuries/${c.id}`}>
                {scope === 'WORKER'
                  ? (['DRAFT', 'DISPUTED'].includes(c.status) ? '查看确认进度' : '查看/补资料')
                  : (c.status === 'DRAFT' ? '去确认' : '处理跟进')}
              </Link>
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              {c.injuryDesc} · {c.positionAtInjury}
              {c.hospital && ` · ${c.hospital}`} · 医疗费 {fmtMoney(c.medicalExpense)}
            </div>
            <div className="row small" style={{ marginTop: 6, gap: 8 }}>
              {c.coveredAtOccurrence ? <Badge tone="green">事故时保险有效</Badge> : <Badge tone="red">事故时保险未生效</Badge>}
              {c.attendanceGap && <Badge tone="red">考勤缺失·{({
                PENDING: '追查中', CONFIRMED_ARRIVAL: '承认到岗', NO_ARRIVAL: '未到岗', UNVERIFIABLE: '无法核实',
              } as any)[c.attendanceGapResult]}</Badge>}
              {c.claimStatus && <Badge tone="blue">理赔：{({
                REPORTED: '已报案', WAITING_DOCS: '待补资料', DOCS_SUBMITTED: '资料待审核',
                APPROVED: '已赔付', REJECTED: '保险拒赔', INVESTIGATING: '调查中',
              } as any)[c.claimStatus]}</Badge>}
              <Badge tone={({ PENDING: 'orange', ENTERPRISE: 'red', WORKER: 'gray', THIRD_PARTY: 'purple', JOINT: 'red' } as any)[c.liability] || 'gray'}>
                责任：{({ PENDING: '待判定', ENTERPRISE: '企业全责', WORKER: '工人原因', THIRD_PARTY: '第三方', JOINT: '多方分担' } as any)[c.liability]}
              </Badge>
              {c.settlementStatus && <Badge tone={c.settlementPaid ? 'green' : 'orange'}>
                工资{c.settlementPaid ? '已结清' : '待发放'}</Badge>}
              {c.missingMaterials.length > 0 && <span style={{ color: 'var(--red)' }}>待补：{c.missingMaterials.slice(0, 3).join('、')}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
