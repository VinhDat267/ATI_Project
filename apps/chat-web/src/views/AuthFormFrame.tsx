import type { ReactNode } from 'react';
import { PlanoraAuthFrame } from '../planora/layout/PlanoraAuthFrame';

export interface AuthViewProps {
  navigate: (path: string, replace?: boolean) => void;
  authConfig?: { signupEnabled: boolean; googleEnabled: boolean };
  token?: string;
}

export function AuthFormFrame({
  title,
  description,
  children,
  navigate,
}: {
  title: string;
  description: string;
  children: ReactNode;
  navigate: AuthViewProps['navigate'];
}) {
  return (
    <PlanoraAuthFrame
      title={title}
      subtitle={description}
      onClose={() => navigate('/login')}
      footer={
        <div className="planora-auth-switch" style={{ justifyContent: 'center' }}>
          <button
            type="button"
            className="planora-auth-link-btn"
            onClick={() => navigate('/login')}
          >
            ← Quay lại đăng nhập
          </button>
        </div>
      }
    >
      {children}
    </PlanoraAuthFrame>
  );
}

export const authInputClass =
  'planora-auth-input w-full px-4 py-2.5 rounded-xl text-sm box-border';

export const authButtonClass =
  'planora-auth-submit w-full py-3 rounded-pill font-semibold text-sm box-border';

export function AuthFeedback({
  error,
  message,
}: {
  error?: string | null;
  message?: string | null;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="planora-auth-error text-sm rounded-xl p-3">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="planora-auth-success text-sm rounded-xl p-3">
          {message}
        </p>
      )}
    </>
  );
}
