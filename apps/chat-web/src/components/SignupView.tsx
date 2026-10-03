import { useRef, useState } from "react";
import { Mail, LockKeyhole, UserRound } from "lucide-react";
import { Brand, Icon } from "./Brand";
import { LoginStory } from "./LoginStory";
import { PublicFooter } from "./PublicFooter";
import { apiClient } from "../services/api-client";
import { userError } from "../services/user-error";
import "../login.css";
export function SignupView({
  onLogin,
  onBackToLanding,
  signupEnabled,
}: {
  onLogin: () => void;
  onBackToLanding: () => void;
  signupEnabled: boolean | null;
}) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  const [resend, setResend] = useState("");
  const busy = useRef(false);
  return (
    <div className="public-page ati-login">
      <a className="skip-link" href="#signup-form">
        Đến phần tạo tài khoản
      </a>
      <header className="public-nav">
        <Brand onClick={onBackToLanding} />
        <button className="btn subtle" onClick={onBackToLanding}>
          <Icon name="back" />
          Về giới thiệu
        </button>
      </header>
      <main className="login-main" id="main">
        <LoginStory />
        <section className="login-form-wrap" aria-labelledby="signup-title">
          <div className="login-form-kicker">
            <span aria-hidden="true" />
            <div className="eyebrow">KHỞI ĐẦU CÙNG PLANORA</div>
          </div>
          <h1 id="signup-title">
            Dành một chỗ
            <br />
            cho ý tưởng.
          </h1>
          {sent ? (
            <div className="auth-result" role="status">
              <Mail className="icon" aria-hidden="true" />
              <h2>Kiểm tra email của bạn.</h2>
              <p>
                Hãy mở email xác minh. Sau khi xác minh, quản trị viên sẽ duyệt
                quyền truy cập không gian làm việc.
              </p>
              <button
                className="btn"
                disabled={pending}
                onClick={async () => {
                  if (busy.current) return;
                  busy.current = true;
                  setPending(true);
                  setResend("");
                  try {
                    await apiClient.resendVerification(email);
                    setResend(
                      "Nếu tài khoản cần xác minh, email mới sẽ được gửi.",
                    );
                  } catch (err) {
                    setResend(userError(err));
                  } finally {
                    busy.current = false;
                    setPending(false);
                  }
                }}
              >
                {pending ? "Đang gửi…" : "Gửi lại email xác minh"}
              </button>
              {resend && <p>{resend}</p>}
              <button className="btn primary" onClick={onLogin}>
                Về đăng nhập
                <Icon name="arrow" />
              </button>
            </div>
          ) : signupEnabled !== true ? (
            <div className="auth-result" role="status">
              <p>
                {signupEnabled === null
                  ? "Đang kiểm tra khả năng đăng ký…"
                  : "Đăng ký hiện chưa khả dụng. Hãy liên hệ quản trị viên hoặc đăng nhập bằng tài khoản hiện có."}
              </p>
            </div>
          ) : (
            <>
              <p>Tạo tài khoản để bắt đầu cùng Planora.</p>
              <form
                id="signup-form"
                aria-label="Tạo tài khoản Planora"
                aria-busy={pending}
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy.current) return;
                  setError("");
                  if (password !== confirm) {
                    setError("Mật khẩu nhập lại chưa khớp.");
                    return;
                  }
                  busy.current = true;
                  setPending(true);
                  try {
                    await apiClient.signup({ name, email, password });
                    setPassword("");
                    setConfirm("");
                    setSent(true);
                  } catch (err) {
                    setError(userError(err));
                  } finally {
                    busy.current = false;
                    setPending(false);
                  }
                }}
              >
                <div className="field">
                  <label htmlFor="signup-name">Tên của bạn</label>
                  <div className="login-input-wrap">
                    <UserRound className="icon" aria-hidden="true" />
                    <input
                      id="signup-name"
                      autoComplete="name"
                      maxLength={100}
                      required
                      disabled={pending}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Bạn muốn được gọi là gì?"
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="signup-email">Email</label>
                  <div className="login-input-wrap">
                    <Mail className="icon" aria-hidden="true" />
                    <input
                      id="signup-email"
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      required
                      disabled={pending}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ban@congty.vn"
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="signup-password">Mật khẩu</label>
                  <div className="password-field">
                    <LockKeyhole
                      className="icon login-input-icon"
                      aria-hidden="true"
                    />
                    <input
                      id="signup-password"
                      type={visible ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                      disabled={pending}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-describedby="signup-password-hint"
                    />
                    <button
                      type="button"
                      disabled={pending}
                      aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      aria-pressed={visible}
                      onClick={() => setVisible(!visible)}
                    >
                      <Icon name={visible ? "eyeoff" : "eye"} />
                    </button>
                  </div>
                  <span
                    className="auth-password-hint"
                    id="signup-password-hint"
                  >
                    Từ 12 đến 128 ký tự. Ưu tiên một cụm từ dài, khó đoán.
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="signup-confirm">Nhập lại mật khẩu</label>
                  <div className="login-input-wrap">
                    <LockKeyhole className="icon" aria-hidden="true" />
                    <input
                      id="signup-confirm"
                      type={visible ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                      disabled={pending}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      aria-invalid={error.includes("khớp") || undefined}
                      aria-describedby={error ? "signup-error" : undefined}
                    />
                  </div>
                </div>
                {error && (
                  <p className="field-error" role="alert" id="signup-error">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  className="btn primary submit"
                  disabled={pending}
                >
                  {pending ? (
                    <>
                      <span className="spinner" />
                      Đang tạo tài khoản…
                    </>
                  ) : (
                    <>
                      Tạo tài khoản
                      <Icon name="arrow" />
                    </>
                  )}
                </button>
                <p className="auth-policy">
                  <Icon name="shield" /> Xác minh email và chờ quản trị viên
                  duyệt trước khi sử dụng các dịch vụ của nhóm.
                </p>
              </form>
            </>
          )}
          {!sent && (
            <div className="auth-switch">
              <span>Đã có tài khoản?</span>
              <button type="button" onClick={onLogin}>
                Đăng nhập
                <Icon name="arrow" />
              </button>
            </div>
          )}
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
