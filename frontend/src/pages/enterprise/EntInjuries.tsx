import { InjuryList } from '../shared/InjuryList';

export default function EntInjuries() {
  return <InjuryList endpoint="/enterprise/injuries" title="本企业工伤事件" scope="ENTERPRISE" />;
}
