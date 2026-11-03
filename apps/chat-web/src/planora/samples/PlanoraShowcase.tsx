import { useState, useEffect } from 'react';
import { LandingSample } from './LandingSample';
import { ChatPlanSample } from './ChatPlanSample';
import { SettingsScopeSample } from './SettingsScopeSample';
import { HistoryScheduleSample } from './HistoryScheduleSample';
import { Button } from '../components/Button';

export type SampleViewType = 'landing' | 'chat-plan' | 'settings-scope' | 'history-schedule';

export interface PlanoraShowcaseProps {
  initialView?: SampleViewType;
}

/**
 * Thư viện kiểm duyệt 4 mẫu tham chiếu Planora (PL-01)
 * Hỗ trợ chuyển đổi nhanh giữa 4 mẫu và đổi theme sáng/tối đồng bộ qua ati-theme.
 */
export function PlanoraShowcase({ initialView = 'landing' }: PlanoraShowcaseProps) {
  const [activeView, setActiveView] = useState<SampleViewType>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('sample');
      if (param === 'chat' || param === 'chat-plan') return 'chat-plan';
      if (param === 'settings' || param === 'settings-scope') return 'settings-scope';
      if (param === 'history' || param === 'history-schedule') return 'history-schedule';
      if (param === 'landing') return 'landing';
    }
    return initialView;
  });

  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ dark?: boolean }>;
      if (typeof customEvent.detail?.dark === 'boolean') {
        setIsDark(customEvent.detail.dark);
      } else {
        setIsDark(document.documentElement.classList.contains('dark'));
      }
    };

    window.addEventListener('ati:theme', handleThemeChange);
    return () => window.removeEventListener('ati:theme', handleThemeChange);
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', newDark);
      document.documentElement.setAttribute('data-theme', newDark ? 'dark' : 'light');
      document.documentElement.style.colorScheme = newDark ? 'dark' : 'light';
      try {
        localStorage.setItem('ati-theme', newDark ? 'dark' : 'light');
      } catch {
        // Safe fallback when storage blocked
      }
      window.dispatchEvent(new CustomEvent('ati:theme', { detail: { dark: newDark } }));
    }
  };

  return (
    <div className="planora-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Showcase Master Bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 9999,
          backgroundColor: isDark ? '#1a241b' : '#2e382d',
          color: '#f5f1e7',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          fontSize: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ letterSpacing: '0.04em', color: '#c4d59e' }}>PLANORA PL-01</strong>
          <span>Bộ 4 Mẫu Trình Duyệt:</span>
        </div>

        {/* View Switcher Tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            variant={activeView === 'landing' ? 'primary' : 'ghost'}
            style={{
              minHeight: 30,
              padding: '4px 10px',
              fontSize: 11,
              color: activeView === 'landing' ? undefined : '#f5f1e7',
            }}
            onClick={() => setActiveView('landing')}
          >
            1. Landing
          </Button>
          <Button
            size="sm"
            variant={activeView === 'chat-plan' ? 'primary' : 'ghost'}
            style={{
              minHeight: 30,
              padding: '4px 10px',
              fontSize: 11,
              color: activeView === 'chat-plan' ? undefined : '#f5f1e7',
            }}
            onClick={() => setActiveView('chat-plan')}
          >
            2. Chat có plan
          </Button>
          <Button
            size="sm"
            variant={activeView === 'settings-scope' ? 'primary' : 'ghost'}
            style={{
              minHeight: 30,
              padding: '4px 10px',
              fontSize: 11,
              color: activeView === 'settings-scope' ? undefined : '#f5f1e7',
            }}
            onClick={() => setActiveView('settings-scope')}
          >
            3. Settings (OAuth &amp; Scope)
          </Button>
          <Button
            size="sm"
            variant={activeView === 'history-schedule' ? 'primary' : 'ghost'}
            style={{
              minHeight: 30,
              padding: '4px 10px',
              fontSize: 11,
              color: activeView === 'history-schedule' ? undefined : '#f5f1e7',
            }}
            onClick={() => setActiveView('history-schedule')}
          >
            4. Nhật ký có lịch
          </Button>
        </div>

        {/* Theme Switcher Button */}
        <div>
          <button
            type="button"
            onClick={toggleTheme}
            style={{
              background: isDark ? '#2e382d' : '#3c5741',
              color: '#f5f1e7',
              border: '1px solid #656b5b',
              borderRadius: 999,
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            aria-label={`Chuyển sang giao diện ${isDark ? 'sáng' : 'tối'}`}
          >
            <span>{isDark ? '🌙 Chế độ tối' : '☀️ Chế độ sáng'}</span>
          </button>
        </div>
      </div>

      {/* Render Current Sample */}
      <div style={{ flex: 1 }}>
        {activeView === 'landing' && <LandingSample />}
        {activeView === 'chat-plan' && <ChatPlanSample />}
        {activeView === 'settings-scope' && <SettingsScopeSample />}
        {activeView === 'history-schedule' && <HistoryScheduleSample />}
      </div>
    </div>
  );
}
export default PlanoraShowcase;
