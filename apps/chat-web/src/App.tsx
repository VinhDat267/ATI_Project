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
import { GmailCallbackView } from './views/GmailCallbackView';
import { MyCalendarCallbackView } from './views/MyCalendarCallbackView';
import { MySheetsCallbackView } from './views/MySheetsCallbackView';
import { TrelloCallbackView } from './views/TrelloCallbackView';
import { GitHubCallbackView } from './views/GitHubCallbackView';
import { JiraCallbackView } from './views/JiraCallbackView';
import { TelegramCallbackView } from './views/TelegramCallbackView';
import { PrivacyPage } from './pages/Privacy/PrivacyPage';
import { SchedulesCapabilityProvider } from './hooks/use-schedules';
import { PlanoraShell } from './planora/layout/PlanoraShell';
import type { NavTab } from './components/layout/MainNav';
import type { AppRoute } from './routes';
import { useChatStore } from './store/chat-store';

export interface AppProps { initialView?: 'landing' | 'login'; }

export function App({ initialView }: AppProps) {
  useTheme();
  const { route, navigate } = useRoute(initialView);

  const getTab = (kind: AppRoute['kind']): NavTab | undefined => {
    switch (kind) {
      case 'settings': return 'settings';
      case 'history': return 'history';
      case 'admin-users': return 'users';
      case 'guide': return 'guide';
      case 'home':
      case 'conversation':
        return 'workspace';
      default:
        return undefined;
    }
  };

  const handleNewConversation = () => {
    useChatStore.getState().reset({ preservePlanning: true });
    useChatStore.getState().setConversationId(null);
    navigate('/');
  };

  return (
    <SchedulesCapabilityProvider>
      <AuthGate route={route} navigate={navigate}>
        {session => {
          if (route.kind === 'gmail-callback') return <GmailCallbackView input={route.googleCallback} navigate={navigate} />;
          if (route.kind === 'mycalendar-callback') return <MyCalendarCallbackView input={route.mycalendarCallback} navigate={navigate} />;
          if (route.kind === 'mysheets-callback') return <MySheetsCallbackView input={route.mysheetsCallback} navigate={navigate} />;
          if (route.kind === 'trello-callback') return <TrelloCallbackView input={route.trelloCallback} navigate={navigate} />;
          if (route.kind === 'github-callback') return <GitHubCallbackView input={route.githubCallback} navigate={navigate} />;
          if (route.kind === 'jira-callback') return <JiraCallbackView input={route.jiraCallback} navigate={navigate} />;
          if (route.kind === 'telegram-callback') return <TelegramCallbackView input={route.telegramCallback} navigate={navigate} />;

          const currentTab = getTab(route.kind);
          return (
            <PlanoraShell
              user={session.user}
              currentTab={currentTab}
              navigate={navigate}
              onLogout={session.onLogout}
              onNewConversation={handleNewConversation}
            >
              {route.kind === 'not-found' ? (
                <NotFoundPage signedIn navigate={navigate} />
              ) : route.kind === 'settings' ? (
                <SettingsPage user={session.user} authToken={session.authToken} onLogout={session.onLogout} navigate={navigate} />
              ) : route.kind === 'account' ? (
                <AccountPage user={session.user} onLogout={session.onLogout} navigate={navigate} />
              ) : route.kind === 'admin-users' ? (
                <UsersPage user={session.user} onLogout={session.onLogout} navigate={navigate} />
              ) : route.kind === 'history' ? (
                <HistoryPage user={session.user} onLogout={session.onLogout} navigate={navigate} />
              ) : route.kind === 'guide' ? (
                <GuidePage navigate={navigate} user={session.user} onLogout={session.onLogout} />
              ) : route.kind === 'privacy' ? (
                <PrivacyPage navigate={navigate} user={session.user} onLogout={session.onLogout} />
              ) : (
                <WorkspaceView {...session} route={route} navigate={navigate} />
              )}
            </PlanoraShell>
          );
        }}
      </AuthGate>
    </SchedulesCapabilityProvider>
  );
}
export default App;
