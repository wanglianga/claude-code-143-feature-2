import { InjuryList } from '../shared/InjuryList';

export default function MyInjuries() {
  return <InjuryList endpoint="/my/injuries" title="我的工伤事件" scope="WORKER" />;
}
