import type { FormEvent } from 'react';
import { LandingPage } from '../pages/Landing/LandingPage';
export interface LoginViewProps {
  email: string; setEmail: (value: string) => void; password: string; setPassword: (value: string) => void;
  isLoggingIn: boolean; authError: string | null; onLogin: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  navigate?: (path: string, replace?: boolean) => void;
  onQuickFillDemo?: () => void; onBackToLanding?: () => void;
  authConfig?: { signupEnabled: boolean; googleEnabled: boolean };
  onSignup?: () => void; onForgotPassword?: () => void; onResendVerification?: () => void;
}
export function LoginView(props: LoginViewProps) {
  const navigate = props.navigate ?? ((path: string) => { if (path === '/') props.onBackToLanding?.(); else if (path === '/signup') props.onSignup?.(); else if (path === '/forgot-password') props.onForgotPassword?.(); else if (path === '/resend-verification') props.onResendVerification?.(); });
  const authError = props.authError?.toLowerCase().includes('invalid email or password') ? 'Email hoặc mật khẩu không chính xác.' : props.authError;
  return <LandingPage {...props} navigate={navigate} authError={authError} initialMode="login" />;
}
