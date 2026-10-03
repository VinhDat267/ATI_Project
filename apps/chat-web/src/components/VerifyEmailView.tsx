import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Brand, Icon } from "./Brand";
import { LoginStory } from "./LoginStory";
import { PublicFooter } from "./PublicFooter";
import { apiClient } from "../services/api-client";
import { userError } from "../services/user-error";
import "../login.css";
export function VerifyEmailView({
  token,
  onLogin,
  onBackToLanding,
}: {
  token: string | null;
  onLogin: () => void;
  onBackToLanding: () => void;
}) {
  const [result, setResult] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const request = useRef<Promise<{ message: string }> | null>(null);
  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url);
  }, []);
  useEffect(() => {
    let active = true;
    if (!token) {
      setResult({
        message:
          "Link xác minh không hợp lệ. Về đăng nhập để yêu cầu email xác minh mới.",
        error: true,
      });
      return;
    }
    request.current ??= apiClient.verifyEmail(token);
    request.current
      .then((data) => {
        if (active) setResult({ message: data.message, error: false });
      })
      .catch((error) => {
        if (active) setResult({ message: userError(error), error: true });
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <div className="public-page ati-login">
      <header className="public-nav">
        <Brand onClick={onBackToLanding} />
        <button className="btn subtle" onClick={onBackToLanding}>
          <Icon name="back" />
          Về giới thiệu
        </button>
      </header>
      <main className="login-main" id="main">
        <LoginStory />
        <section className="login-form-wrap">
          <div className="eyebrow">TÀI KHOẢN PLANORA</div>
          <h1>Một bước gần hơn.</h1>
          <div
            className="auth-result"
            role={result?.error ? "alert" : "status"}
          >
            <Icon name={result?.error ? "help" : result ? "check" : "clock"} />
            <h2>
              {result?.error
                ? "Kiểm tra link xác minh."
                : result
                  ? "Email đã xác minh."
                  : "Đang xác minh email…"}
            </h2>
            <p>{result?.message || "Chúng tôi đang kiểm tra link của bạn."}</p>
            <button className="btn primary" onClick={onLogin}>
              Về đăng nhập
              <Icon name="arrow" />
            </button>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
