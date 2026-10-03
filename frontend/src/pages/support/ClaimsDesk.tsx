import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Alert, Badge, ClaimStatusBadge, Spinner, StatusBadge, fmtDateTime, fmtMoney } from '../../components/ui';

const LIABILITY: Record<string, string> = {
  PENDING: '责任待判定', ENTERPRISE_LIABLE: '企业全责', WORKER_LIABLE: '工人原因',
  SHARED: '双方分担', NO_LIABILITY: '意外无责',
};

export default function ClaimsDesk() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  const load = () => get('/claims').then(setList).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  if (loading) return <Spinner />;

  const open = list.filter((c) => c.status !== 'CLOSED');
  const needReport = open.filter((c) => !c.reportedToInsurer);
  const needLiability = open.filter((c) => c.liabilityResult === 'PENDING');
  const attendanceIssue = open.filter((c) => c.attendanceIssue || !c.coveredAtOccurrence);
  const shown = filter === 'ALL' ? list : open.filter((c) => {
    if (filter === 'REPORT') return !c.reportedToInsurer;
    if (filter === 'LIABILITY') return c.liabilityResult === 'PENDING';
    if (filter === 'ATTENDANCE') return c.attendanceIssue || !c.coveredAtOccurrence;
    if (filter === 'OPEN') return true;
    return true;
  });

  return (
    <div>
      <h1>工伤事件与保险报案</h1>
      <Alert kind="warn">
        流程：现场记录（事故时间/岗位/照片/票据/保险状态）→ 主管确认工伤事实 → 客服发起保险报案 →
        持续跟进理赔资料与医院补票、医疗垫付、企业责任意见与平台责任判定 → 工资按已完成工时先行结算（不阻塞、不替代理赔）→ 结案。
        <b>铁律：事故时点保险未生效的保单不可改赔，禁止事后补录；工资结清后事故仍持续跟进到结案。</b>
      </Alert>

      <div className="grid grid-4">
        <div className="card stat"><div className="v">{open.length}</div><div className="l">跟进中事故</div></div>
        <div className="card stat"><div className="v" style={{ color: 'var(--orange)' }}>{needReport.length}</div><div className="l">待发起报案</div></div>
        <div className="card stat"><div className="v" style={{ color: 'var(--red)' }}>{attendanceIssue.length}</div><div className="l">考勤/保险异常</div></div>
        <div className="card stat"><div className="v">{needLiability.length}</div><div className="l">责任待判定</div></div>
      </div>

      <div className="risk-pills">
        {[['ALL', '全部'], ['OPEN', '跟进中'], ['REPORT', '待报案'], ['ATTENDANCE', '考勤/保险异常'], ['LIABILITY', '责任待判定']].map(([k, l]) => (
          <button key={k} className={`btn btn-sm ${filter === k ? 'btn-primary' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>#</th><th>工人/企业/岗位</th><th>事故（时间·岗位）</th><th>保险</th><th>主管</th>
              <th>报案</th><th>工资</th><th>垫付</th><th>责任</th><th>状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td className="small">
                  {c.workerName}<br />
                  <span className="muted">{c.enterpriseName}</span><br />
                  <Badge tone="blue">{c.jobTitle}</Badge>
                </td>
                <td className="small" style={{ maxWidth: 200 }}>
                  {fmtDateTime(c.accidentAt)}<br />
                  <span className="muted">{c.workPosition}</span><br />
                  {c.injuryDesc}
                </td>
                <td>{c.coveredAtOccurrence ? <Badge tone="green">保障期内</Badge> : <Badge tone="red">未生效</Badge>}</td>
                <td>{c.supervisorConfirmed ? <Badge tone="green">已确认</Badge> : <Badge tone="orange">未确认</Badge>}</td>
                <td>{c.reportedToInsurer
                  ? <span className="small">已报案<br /><span className="muted">{c.insurerReportNo}</span></span>
                  : <Badge tone="orange">待报案</Badge>}</td>
                <td className="small">
                  {c.settlementStatus
                    ? <><StatusBadge status={c.settlementStatus} /><br /><span className="money">{fmtMoney(c.workerPayable)}</span></>
                    : <Badge tone="orange">待结</Badge>}
                </td>
                <td className="small">{Number(c.medicalAdvanceAmount) > 0 ? fmtMoney(c.medicalAdvanceAmount) : '—'}</td>
                <td className="small">{LIABILITY[c.liabilityResult]}</td>
                <td><ClaimStatusBadge status={c.status} /></td>
                <td><Link className="btn btn-primary btn-sm" to={`/claims/${c.id}`}>处理</Link></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={11} className="muted">暂无理赔单</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
