import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Badge, ClaimStatusBadge, Spinner, StatusBadge, fmtDateTime, fmtMoney } from '../../components/ui';

export default function MyClaims() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { get('/claims/my').then(setList).finally(() => setLoading(false)); }, []);
  if (loading) return <Spinner />;

  return (
    <div>
      <h1>我的工伤记录</h1>
      <div className="card">
        作业中受伤请在任务室「作业事件」里现场实时上报。之后可在此查看：日结工资会先按已完成工时结算，
        医疗垫付、保险理赔、医院补票与责任判定由客服持续跟进——<b>即使工资已结清，事故也会一直跟到结案</b>。
      </div>
      {list.length === 0 ? (
        <div className="card muted">暂无工伤记录</div>
      ) : (
        <div className="col">
          {list.map((c) => (
            <div key={c.id} className="card">
              <div className="row">
                <Badge tone="red">工伤 #{c.id}</Badge>
                <b>{c.jobTitle}</b>
                <div className="spacer" />
                <ClaimStatusBadge status={c.status} />
              </div>
              <div className="small muted" style={{ margin: '6px 0' }}>
                {fmtDateTime(c.accidentAt)} · {c.workPosition} · {c.enterpriseName}
              </div>
              <div className="small">{c.injuryDesc}</div>
              <div className="row" style={{ marginTop: 8 }}>
                {c.coveredAtOccurrence ? <Badge tone="green">事故时保险在保障期内</Badge> : <Badge tone="red">事故时保险未生效</Badge>}
                <span className="small">工资：{c.settlementStatus
                  ? <><StatusBadge status={c.settlementStatus} /> {fmtMoney(c.workerPayable)}</>
                  : '按工时结算中'}</span>
                {Number(c.medicalAdvanceAmount) > 0 && <span className="small">医疗已垫付 {fmtMoney(c.medicalAdvanceAmount)}</span>}
                <div className="spacer" />
                <Link className="btn btn-primary btn-sm" to={`/claims/${c.id}`}>查看/补交票据</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
