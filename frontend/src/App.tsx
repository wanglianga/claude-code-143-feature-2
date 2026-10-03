import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useAuth } from './auth';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import JobHall from './pages/worker/JobHall';
import JobDetail from './pages/worker/JobDetail';
import MyTasks from './pages/worker/MyTasks';
import MyClaims from './pages/worker/MyClaims';
import TaskRoom from './pages/TaskRoom';
import ClaimDetail from './pages/ClaimDetail';
import Profile from './pages/worker/Profile';
import MyAppeals from './pages/worker/MyAppeals';
import EntDashboard from './pages/enterprise/EntDashboard';
import PostJob from './pages/enterprise/PostJob';
import ManageJobs from './pages/enterprise/ManageJobs';
import JobApplicants from './pages/enterprise/JobApplicants';
import EntAppeals from './pages/enterprise/EntAppeals';
import EntClaims from './pages/enterprise/EntClaims';
import FieldBoard from './pages/enterprise/FieldBoard';
import SupportAppeals from './pages/support/SupportAppeals';
import AppealDesk from './pages/support/AppealDesk';
import ClaimsDesk from './pages/support/ClaimsDesk';
import RiskOverview from './pages/support/RiskOverview';

const roleNav: Record<string, { to: string; label: string }[]> = {
  WORKER: [
    { to: '/jobs', label: '岗位大厅' },
    { to: '/my/tasks', label: '我的任务' },
    { to: '/my/claims', label: '我的工伤' },
    { to: '/my/appeals', label: '我的申诉' },
    { to: '/profile', label: '实名资料' },
  ],
  ENTERPRISE: [
    { to: '/ent', label: '企业总览' },
    { to: '/ent/post', label: '发布需求' },
    { to: '/ent/jobs', label: '岗位管理' },
    { to: '/ent/field', label: '现场工作台' },
    { to: '/ent/claims', label: '工伤处理' },
    { to: '/ent/appeals', label: '争议处理' },
  ],
  SUPERVISOR: [
    { to: '/ent/field', label: '现场确认台' },
    { to: '/ent/claims', label: '工伤处理' },
    { to: '/ent/jobs', label: '本企业岗位' },
  ],
  SUPPORT: [
    { to: '/support/appeals', label: '申诉工单' },
    { to: '/support/claims', label: '工伤理赔' },
    { to: '/support/risk', label: '风险画像' },
  ],
};

function Shell() {
  const { user, logout } = useAuth();
  if (!user) return <Login />;
  const nav = roleNav[user.role] || [];
  const home = nav[0]?.to || '/';
  return (
    <>
      <div className="topbar">
        <div className="brand-name">零工邦<span className="dot">·</span></div>
        <span className="small muted">{roleName(user.role)}</span>
        <div className="spacer" />
        <div className="side-nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}>{n.label}</NavLink>
          ))}
        </div>
        <div className="spacer" />
        <span className="small">{user.name}</span>
        <button className="btn btn-sm" onClick={logout}>退出</button>
      </div>
      <div className="page">
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />

          <Route path="/jobs" element={<JobHall />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/my/tasks" element={<MyTasks />} />
          <Route path="/my/claims" element={<MyClaims />} />
          <Route path="/my/appeals" element={<MyAppeals />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/room/:id" element={<TaskRoom />} />
          <Route path="/claims/:id" element={<ClaimDetail />} />

          <Route path="/ent" element={<EntDashboard />} />
          <Route path="/ent/post" element={<PostJob />} />
          <Route path="/ent/jobs" element={<ManageJobs />} />
          <Route path="/ent/jobs/:id/applicants" element={<JobApplicants />} />
          <Route path="/ent/appeals" element={<EntAppeals />} />
          <Route path="/ent/claims" element={<EntClaims />} />
          <Route path="/ent/field" element={<FieldBoard />} />

          <Route path="/support/appeals" element={<SupportAppeals />} />
          <Route path="/support/appeals/:id" element={<AppealDesk />} />
          <Route path="/support/claims" element={<ClaimsDesk />} />
          <Route path="/support/risk" element={<RiskOverview />} />

          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </div>
    </>
  );
}

function roleName(r: string) {
  return ({ WORKER: '工人端', ENTERPRISE: '企业端', SUPERVISOR: '现场主管端', SUPPORT: '平台客服端' } as any)[r] || r;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <div style={{ padding: 80 }}><Spinner /></div>;
  return <Shell />;
}
