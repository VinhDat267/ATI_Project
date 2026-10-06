import type { ComponentType } from 'react';
import { useLocation } from './app/router';
import { ThemeToggle } from './app/ThemeToggle';
import { AccountPage } from './pages/Account/AccountPage';
import { AuthActionPage } from './pages/AuthAction/AuthActionPage';
import { ErrorsPage } from './pages/Errors/ErrorsPage';
import { GuidePage } from './pages/Guide/GuidePage';
import { HistoryPage } from './pages/History/HistoryPage';
import { NotFoundPage } from './pages/NotFound/NotFoundPage';
import { PrivacyPage } from './pages/Privacy/PrivacyPage';
import { ResponsesPage } from './pages/Responses/ResponsesPage';
import { SettingsPage } from './pages/Settings/SettingsPage';
import { UsersPage } from './pages/Users/UsersPage';

// Route ứng với file bản mẫu: privacy.html → /privacy. Trang chưa chuyển hoặc đường dẫn lạ hiện trang 404, như máy chủ tĩnh.
const pages: Record<string, ComponentType> = {
  '/404': NotFoundPage,
  '/privacy': PrivacyPage,
  '/errors': ErrorsPage,
  '/responses': ResponsesPage,
  '/auth-action': AuthActionPage,
  '/account': AccountPage,
  '/users': UsersPage,
  '/settings': SettingsPage,
  '/history': HistoryPage,
  '/guide': GuidePage,
};

export function App() {
  const location = useLocation();
  const pathname = location.split('?')[0].replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const Page = pages[pathname] ?? NotFoundPage;
  // key theo đường dẫn: đổi trang thì dựng lại cả trang và nút Sáng/Tối, như tải một file HTML mới.
  return <>
    <Page key={pathname} />
    <ThemeToggle key={`theme-${pathname}`} />
  </>;
}
