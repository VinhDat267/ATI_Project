import { type ReactNode, type MouseEvent } from 'react';
import { Brand } from '../components/Brand';
import { Button } from '../components/Button';
import { ThemeToggle } from '../../prototype/ThemeToggle';

export interface PlanoraPublicHeaderProps {
  navigate?: (path: string) => void;
  actions?: ReactNode;
  children?: ReactNode;
}

export function PlanoraPublicHeader({ navigate, actions, children }: PlanoraPublicHeaderProps) {
  const follow = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate?.(path);
  };

  return (
    <header className="planora-public-header" role="banner">
      <div className="planora-public-header-inner">
        <Brand size="md" onClick={() => navigate?.('/')} />

        <nav className="planora-public-nav" aria-label="Điều hướng công khai">
          <a href="/guide" onClick={follow('/guide')}>
            Cẩm nang
          </a>
          <a href="/privacy" onClick={follow('/privacy')}>
            Chính sách an toàn
          </a>
        </nav>

        <div className="planora-public-header-actions">
          {actions}
          <ThemeToggle />
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate?.('/login')}
          >
            Đăng nhập
          </Button>
        </div>
      </div>
      {children}
    </header>
  );
}
export default PlanoraPublicHeader;
