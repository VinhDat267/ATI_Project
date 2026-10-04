import { AuthGate } from './components/AuthGate';
import { WorkspaceView } from './views/WorkspaceView';
import { useRoute } from './hooks/use-route';
import { AdminUsersView } from './views/AdminUsersView';
import { AccountView } from './views/AccountView';

export interface AppProps { initialView?: 'landing' | 'login'; }
export function App({ initialView }: AppProps) {
  const { route, navigate } = useRoute(initialView);
  return <AuthGate route={route} navigate={navigate}>
    {session => route.kind === 'admin-users' ? <AdminUsersView user={session.user} onLogout={session.onLogout} navigate={navigate} />
      : route.kind === 'account' ? <AccountView user={session.user} onLogout={session.onLogout} navigate={navigate} />
      : <WorkspaceView {...session} route={route} navigate={navigate} />}
  </AuthGate>;
}
export default App;
