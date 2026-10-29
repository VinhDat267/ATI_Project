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
import { NotionCallbackView } from './views/NotionCallbackView';
import { GmailCallbackView } from './views/GmailCallbackView';
import { MyCalendarCallbackView } from './views/MyCalendarCallbackView';
import { MySheetsCallbackView } from './views/MySheetsCallbackView';
import { PrivacyPage } from './pages/Privacy/PrivacyPage';
import { SchedulesCapabilityProvider } from './hooks/use-schedules';

export interface AppProps { initialView?: 'landing' | 'login'; }
export function App({ initialView }: AppProps) {
  useTheme();
  const { route, navigate } = useRoute(initialView);
  return <SchedulesCapabilityProvider><AuthGate route={route} navigate={navigate}>
    {session => route.kind === 'notion-callback' ? <NotionCallbackView input={route.googleCallback} navigate={navigate} /> : route.kind === 'gmail-callback' ? <GmailCallbackView input={route.googleCallback} navigate={navigate} /> : route.kind === 'mycalendar-callback' ? <MyCalendarCallbackView input={route.mycalendarCallback} navigate={navigate} /> : route.kind === 'mysheets-callback' ? <MySheetsCallbackView input={route.mysheetsCallback} navigate={navigate} /> : route.kind === 'not-found' ? <NotFoundPage signedIn navigate={navigate} /> : route.kind === 'settings' ? <SettingsPage user={session.user} authToken={session.authToken} onLogout={session.onLogout} navigate={navigate} /> : route.kind === 'account' ? <AccountPage user={session.user} onLogout={session.onLogout} navigate={navigate} /> : route.kind === 'admin-users' ? <UsersPage user={session.user} onLogout={session.onLogout} navigate={navigate} /> : route.kind === 'history' ? <HistoryPage user={session.user} onLogout={session.onLogout} navigate={navigate} /> : route.kind === 'guide' ? <GuidePage navigate={navigate} user={session.user} onLogout={session.onLogout} /> : route.kind === 'privacy' ? <PrivacyPage navigate={navigate} user={session.user} onLogout={session.onLogout} /> : <WorkspaceView {...session} route={route} navigate={navigate} />}
  </AuthGate></SchedulesCapabilityProvider>;
}
export default App;
