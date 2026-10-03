import React, { useState } from "react";
import { Brand, Icon } from "./Brand";
import { userError } from "../services/user-error";
import { Mail, LockKeyhole, ArrowUpRight } from "lucide-react";
import { LoginStory } from "./LoginStory";
import { PublicFooter } from './PublicFooter';
import { apiClient } from '../services/api-client';
import "../login.css";
export interface LoginViewProps {
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  isLoggingIn: boolean;
  authError: string | null;
  onLogin: (event: React.FormEvent<HTMLFormElement>) => void;
  onBackToLanding?: () => void;
  onSignup?: () => void;
  signupEnabled?: boolean;
}
export function LoginView({
  email,
  setEmail,
  password,
  setPassword,
  isLoggingIn,
  authError,
  onLogin,
  onBackToLanding,
  onSignup,
  signupEnabled = false,
}: LoginViewProps) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [resendMessage,setResendMessage] = useState('');
  const [resending,setResending] = useState(false);
  return (
    <div className="public-page ati-login">
      <a className="skip-link" href="#login-form">
        Đến phần đăng nhập
      </a>
      <header className="public-nav">
        <Brand onClick={onBackToLanding} />
        <button
          className="btn subtle"
          onClick={onBackToLanding}
          aria-label="Quay lại trang giới thiệu"
        >
          <Icon name="back" />
          Về giới thiệu
        </button>
      </header>
      <main className="login-main" id="main">
        <LoginStory />
        <section className="login-form-wrap" aria-labelledby="login-title">
          <div className="login-form-kicker">
            <span aria-hidden="true" />
            <div className="eyebrow">KHÔNG GIAN LÀM VIỆC Planora</div>
          </div>
          <h1 id="login-title">
            Chào mừng
            <br />
            trở lại.
          </h1>
          <p>Đăng nhập để tiếp tục không gian làm việc của bạn.</p>
          <form
            id="login-form"
            aria-label="Đăng nhập Planora"
            aria-busy={isLoggingIn}
            onSubmit={(event) => {
              if (isLoggingIn) {
                event.preventDefault();
                return;
              }
              onLogin(event);
            }}
          >
            <div className="field">
              <label htmlFor="email">Email</label>
              <div className="login-input-wrap">
                <Mail className="icon" aria-hidden="true" />
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  aria-describedby={authError ? "login-auth-error" : undefined}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoggingIn}
                  placeholder="ban@congty.vn"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="password">Mật khẩu</label>
              <div className="password-field">
                <LockKeyhole
                  className="icon login-input-icon"
                  aria-hidden="true"
                />
                <input
                  id="password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  aria-describedby={
                    [
                      capsLock ? "login-caps-lock" : "",
                      authError ? "login-auth-error" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  onKeyDown={(event) =>
                    setCapsLock(event.getModifierState("CapsLock"))
                  }
                  onKeyUp={(event) =>
                    setCapsLock(event.getModifierState("CapsLock"))
                  }
                  onBlur={() => setCapsLock(false)}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoggingIn}
                />
                <button
                  type="button"
                  disabled={isLoggingIn}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                >
                  <Icon name={visible ? "eyeoff" : "eye"} />
                </button>
              </div>
              {capsLock && (
                <span
                  className="login-caps-lock"
                  id="login-caps-lock"
                  role="status"
                >
                  Caps Lock đang bật.
                </span>
              )}
            </div>
            {authError && (
              <p role="alert" className="field-error" id="login-auth-error">
                {userError(authError)}
              </p>
            )}
            <button
              className="btn primary submit"
              type="submit"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? (
                <>
                  <span className="spinner" />
                  Đang đăng nhập…
                </>
              ) : (
                <>
                  Đăng nhập
                  <Icon name="arrow" />
                </>
              )}
            </button>
          </form>
          {authError?.includes('xác minh email trước') && <div className="verification-resend"><button type="button" className="btn" disabled={resending} onClick={async()=>{
            setResending(true);setResendMessage('');try{await apiClient.resendVerification(email);setResendMessage('Nếu tài khoản cần xác minh, email mới sẽ được gửi.');}catch(error){setResendMessage(userError(error));}finally{setResending(false);}
          }}>{resending?'Đang gửi…':'Gửi lại email xác minh'}</button><span role="status">{resendMessage}</span></div>}
          <div className="auth-switch"><span>Chưa có tài khoản?</span>{signupEnabled?<button type="button" onClick={onSignup}>Tạo tài khoản<ArrowUpRight className="icon" aria-hidden="true"/></button>:<span>Liên hệ quản trị viên</span>}</div>
          <div className="login-form-endnote">
            <Icon name="chat" />
            <span>Một lời nhắn. Một khởi đầu nhẹ nhàng.</span>
          </div>
        </section>
      </main>
      <PublicFooter/>
    </div>
  );
}
