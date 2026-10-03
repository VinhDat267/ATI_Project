import { AuthGate } from './components/AuthGate';
import { WorkspaceView } from './views/WorkspaceView';
import { useRoute } from './hooks/use-route';

export interface AppProps { initialView?: 'landing' | 'login'; }
export function App({ initialView }: AppProps) {
  const { route, navigate } = useRoute(initialView);
  return <AuthGate route={route} navigate={navigate}>
    {session => <WorkspaceView {...session} route={route} navigate={navigate} />}
  </AuthGate>;
}
export default App;
