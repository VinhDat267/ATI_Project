import React, { useState } from "react";
import { Brand, Icon } from "./Brand";
import { userError } from "../services/user-error";
export interface LoginViewProps {
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  isLoggingIn: boolean;
  authError: string | null;
  onLogin: (event: React.FormEvent<HTMLFormElement>) => void;
  onBackToLanding?: () => void;
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
}: LoginViewProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="public-page">
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
        <section className="login-editorial" aria-label="Giới thiệu ATI">
          <div className="eyebrow">KHÔNG GIAN CHO CÔNG VIỆC CỦA BẠN</div>
          <h2>
            Ý tưởng của bạn.
            <br />
            Một mạch
            <br />
            công việc chung.
          </h2>
          <p>
            Kết nối yêu cầu với đúng tài nguyên, qua từng bước có thể kiểm tra
            và duyệt.
          </p>
          <div className="editorial-flow">
            {[
              ["chat", "Một lời nhắn", "Bắt đầu từ điều bạn muốn làm"],
              [
                "grid",
                "Một kế hoạch rõ ràng",
                "Kiểm tra trước khi tạo thay đổi",
              ],
              ["arrow", "Công việc được kết nối", "GitHub → Trello → Slack"],
            ].map(([icon, title, copy]) => (
              <div className="editorial-flow-item" key={title}>
                <span className="icon-wrap">
                  <Icon name={icon} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <span>{copy}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="editorial-bottom">
            <span className="brand-word">ati</span>
            <span>Bạn luôn giữ quyền quyết định.</span>
          </div>
        </section>
        <section className="login-form-wrap">
          <div className="eyebrow">BẮT ĐẦU CÙNG ATI</div>
          <h1>
            Chào mừng
            <br />
            trở lại.
          </h1>
          <p>Đăng nhập để tiếp tục không gian làm việc của bạn.</p>
          <form onSubmit={onLogin}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoggingIn}
                placeholder="ban@congty.vn"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Mật khẩu</label>
              <div className="password-field">
                <input
                  id="password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoggingIn}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                >
                  <Icon name={visible ? "eyeoff" : "eye"} />
                </button>
              </div>
            </div>
            {authError && (
              <p role="alert" className="field-error">
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
          <div className="auth-roadmap">
            <span className="pill ghost">Roadmap</span>
            <p>
              Đăng ký, quên mật khẩu và đăng nhập Google đang được phát triển.
            </p>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <span>ati · Từ ý tưởng đến hành động.</span>
        <span>AI Workflow Automation Platform</span>
      </footer>
    </div>
  );
}
