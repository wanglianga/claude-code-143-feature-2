import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Badge, ClaimStatusBadge, Spinner, StatusBadge, fmtDateTime, fmtMoney } from '../../components/ui';

export default function EntClaims() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { get('/claims/enterprise').then(setList).finally(() => setLoading(false)); }, []);
  if (loading) return <Spinner />;

  return (
    <div>
      <h1>本企业工伤事件</h1>
      <div className="card">
        平台记录工人作业中受伤事件后，企业需配合：确认到岗考勤、在理赔单中提交企业责任意见。
        注意：日结工资会先按工人已完成工时结算；医疗垫付、保险理赔与责任判定由平台单独跟进，<b>不会因工资结清而关闭事故</b>。
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>#</th><th>工人/岗位</th><th>事故时间/岗位</th><th>保险</th><th>主管确认</th><th>工资</th><th>责任</th><th>企业意见</th><th>状态</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td className="small">{c.workerName}<br /><Badge tone="blue">{c.jobTitle}</Badge></td>
                <td className="small">{fmtDateTime(c.accidentAt)}<br /><span className="muted">{c.workPosition}</span></td>
                <td>{c.coveredAtOccurrence ? <Badge tone="green">保障期内</Badge> : <Badge tone="red">未生效</Badge>}</td>
                <td>{c.supervisorConfirmed ? <Badge tone="green">已确认</Badge> : <Badge tone="orange">未确认</Badge>}</td>
                <td className="small">{c.settlementStatus
                  ? <><StatusBadge status={c.settlementStatus} /><br />{fmtMoney(c.workerPayable)}</>
                  : <Badge tone="orange">待结</Badge>}</td>
                <td>{({ PENDING: '待判定', ENTERPRISE_LIABLE: '企业全责', WORKER_LIABLE: '工人原因', SHARED: '双方分担', NO_LIABILITY: '意外无责' } as any)[c.liabilityResult]}</td>
                <td className="small">{c.enterpriseOpinion ? <span title={c.enterpriseOpinion}>已提交</span> : <Badge tone="orange">待提交</Badge>}</td>
                <td><ClaimStatusBadge status={c.status} /></td>
                <td><Link className="btn btn-primary btn-sm" to={`/claims/${c.id}`}>查看/处理</Link></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={10} className="muted">本企业暂无工伤事件</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
