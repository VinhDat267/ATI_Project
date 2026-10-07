import { AuthGate } from './components/AuthGate';
import { WorkspaceView } from './views/WorkspaceView';
import { useRoute } from './hooks/use-route';
import { AdminUsersView } from './views/AdminUsersView';
import { AccountView } from './views/AccountView';
import { AppShell } from './components/layout/AppShell';
import { ShellPageView } from './views/ShellPageView';
import { SettingsModal } from './components/SettingsModal';
import { useTheme } from './hooks/use-theme';
import { NotFoundPage } from './pages/NotFound/NotFoundPage';

export interface AppProps { initialView?: 'landing' | 'login'; }
export function App({ initialView }: AppProps) {
  useTheme();
  const { route, navigate } = useRoute(initialView);
  return <AuthGate route={route} navigate={navigate}>
    {session => route.kind === 'not-found' ? <NotFoundPage signedIn navigate={navigate} /> : <AppShell user={session.user} onLogout={session.onLogout} navigate={navigate}>{route.kind === 'admin-users' ? <AdminUsersView user={session.user} onLogout={session.onLogout} navigate={navigate} />
      : route.kind === 'account' ? <AccountView user={session.user} onLogout={session.onLogout} navigate={navigate} />
      : route.kind === 'settings' ? <SettingsModal isOpen page authToken={session.authToken} onClose={() => navigate('/')} />
      : ['history', 'guide', 'privacy'].includes(route.kind) ? <ShellPageView title={route.kind === 'history' ? 'Nhật ký điều phối' : route.kind === 'guide' ? 'Cẩm nang' : 'Chính sách an toàn'} navigate={navigate} />
      : <WorkspaceView {...session} route={route} navigate={navigate} />}</AppShell>}
  </AuthGate>;
}
export default App;
