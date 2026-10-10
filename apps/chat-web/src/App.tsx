import { AuthGate } from './components/AuthGate';
import { WorkspaceView } from './views/WorkspaceView';
import { useRoute } from './hooks/use-route';
import { UsersPage } from './pages/Users/UsersPage';
import { AccountPage } from './pages/Account/AccountPage';
import { HistoryPage } from './pages/History/HistoryPage';
import { SettingsPage } from './pages/Settings/SettingsPage';
import { useTheme } from './hooks/use-theme';
import { NotFoundPage } from './pages/NotFound/NotFoundPage';
import { GuidePage } from './pages/Guide/GuidePage';
import { PrivacyPage } from './pages/Privacy/PrivacyPage';

export interface AppProps { initialView?: 'landing' | 'login'; }
export function App({ initialView }: AppProps) {
  useTheme();
  const { route, navigate } = useRoute(initialView);
  return <AuthGate route={route} navigate={navigate}>
    {session => route.kind === 'not-found' ? <NotFoundPage signedIn navigate={navigate} /> : route.kind === 'settings' ? <SettingsPage user={session.user} authToken={session.authToken} onLogout={session.onLogout} navigate={navigate} /> : route.kind === 'account' ? <AccountPage user={session.user} onLogout={session.onLogout} navigate={navigate} /> : route.kind === 'admin-users' ? <UsersPage user={session.user} onLogout={session.onLogout} navigate={navigate} /> : route.kind === 'history' ? <HistoryPage user={session.user} onLogout={session.onLogout} navigate={navigate} /> : route.kind === 'guide' ? <GuidePage navigate={navigate} user={session.user} onLogout={session.onLogout} /> : route.kind === 'privacy' ? <PrivacyPage navigate={navigate} user={session.user} onLogout={session.onLogout} /> : <WorkspaceView {...session} route={route} navigate={navigate} />}
  </AuthGate>;
}
export default App;
