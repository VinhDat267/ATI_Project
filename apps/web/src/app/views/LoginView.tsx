import { useMutation } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import type { SessionController } from "../../core/session.js";
import type { Transport } from "../../core/contracts.js";
import { ClientError } from "../../core/errors.js";
import { cn } from "@/lib/cn";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Logo } from "../shell/Logo";

const inputClass =
  "h-12 w-full rounded-md border border-hairline bg-surface-strong px-4 text-body-md text-ink outline-none transition-all placeholder:text-muted focus-visible:border-ink focus-visible:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ink/10";

/**
 * Focused Minimalist Elegance LoginView (Linear / Raycast inspired).
 * Centered floating card with ambient lighting, accessible locators,
 * and seamless 1-click demo entry.
 */
export function LoginView({
  transport,
  session,
  mode,
  demoLogin,
  onSignedIn,
}: {
  transport: Transport;
  session: SessionController;
  mode: "fixture" | "live";
  demoLogin?: { email: string; password: string };
  onSignedIn(email: string): void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const errorId = useId();

  const login = useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const scope = session.beginRequest();
      try {
        const token = await transport.login(
          input.email,
          input.password,
          scope.signal,
        );
        return { token, current: scope.isCurrent() };
      } finally {
        scope.dispose();
      }
    },
    retry: 0,
    onSuccess: ({ token, current }, input) => {
      if (!current) return;
      setPassword("");
      session.setToken(token);
      onSignedIn(input.email);
    },
    onError: () => setPassword(""),
  });

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (login.isPending) return;
    login.mutate({ email, password });
  };

  const fillDemoAndSubmit = (): void => {
    if (login.isPending || !demoLogin) return;
    setEmail(demoLogin.email);
    setPassword(demoLogin.password);
    login.mutate(demoLogin);
  };

  const startOidc = (): void => {
    const returnTo =
      typeof window !== "undefined"
        ? window.location.hash.slice(1) || "/overview"
        : "/overview";
    transport.startOidcLogin(returnTo);
  };

  const failed = login.isError;
  const errorMessage = (() => {
    if (!login.error) return null;
    if (login.error instanceof ClientError) {
      if (login.error.status === 401) {
        return "Email hoặc mật khẩu không đúng. Kiểm tra lại mật khẩu rồi thử lại.";
      }
      if (login.error.status === 429) {
        return "Quá nhiều lần thử đăng nhập. Vui lòng đợi và thử lại sau.";
      }
      if (login.error.kind === "network") {
        return "Không thể kết nối đến máy chủ. Kiểm tra kết nối mạng hoặc máy chủ.";
      }
      return login.error.message;
    }
    return "Email hoặc mật khẩu không đúng. Kiểm tra lại mật khẩu rồi thử lại.";
  })();

  return (
    <div className="relative flex min-h-dvh flex-col justify-between overflow-hidden bg-canvas">
      {/* Ambient subtle glow background elements to eliminate dingy parchment feel */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 size-[640px] rounded-full bg-progress-subtle/40 blur-3xl" />
        <div className="absolute top-1/4 -left-24 size-[380px] rounded-full bg-planner-subtle/30 blur-3xl" />
        <div className="absolute bottom-10 -right-24 size-[400px] rounded-full bg-action-subtle/20 blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-hairline/60 bg-surface-soft/40 backdrop-blur-xs">
        <div className="mx-auto flex h-14 max-w-content items-center justify-between px-6 desk:h-16 xl:px-0">
          <Logo />
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-soft px-3 py-0.5 text-caption font-medium text-muted shadow-xs">
              <span className="size-2 rounded-full bg-success" />
              <span>Chạy cục bộ</span>
            </span>
            {mode === "fixture" ? (
              <span className="inline-flex h-6 items-center rounded-full bg-demo-subtle px-2.5 text-badge text-demo border border-demo/10">
                Dữ liệu mô phỏng
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* Main Container: Centered */}
      <main
        id="main-content"
        className="relative z-10 mx-auto flex w-full max-w-[460px] flex-1 flex-col items-center justify-center px-4 py-6 desk:py-8"
      >
        {/* Above Card Header */}
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="mb-2.5 flex size-11 items-center justify-center rounded-full bg-progress-subtle text-progress shadow-xs border border-progress/20">
            <Icon name="shield-check" size={22} />
          </div>
          <h1
            id="login-title"
            className="m-0 text-display-md-mobile font-bold text-ink desk:text-display-md"
          >
            Đăng nhập
          </h1>
          <p className="mt-1 m-0 text-body-sm text-muted">
            Truy cập không gian điều phối quy trình tự động an toàn
          </p>
        </div>

        {/* Centered Auth Card */}
        <form
          aria-labelledby="login-title"
          onSubmit={submit}
          noValidate
          className="flex w-full flex-col gap-4 rounded-lg border border-hairline bg-surface-soft p-6 shadow-auth desk:p-7"
        >
          {failed && errorMessage ? (
            <p
              id={errorId}
              role="alert"
              className="m-0 rounded-md bg-danger-subtle p-3.5 text-body-md text-danger border border-danger/20"
            >
              {errorMessage}
            </p>
          ) : null}

          {/* Quick Demo 1-Click Login Card (Fixture Mode) */}
          {mode === "fixture" && demoLogin ? (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={fillDemoAndSubmit}
                disabled={login.isPending}
                aria-label="Truy cập nhanh 1-Click với tài khoản demo"
                className="group flex w-full items-center justify-between rounded-md border border-progress/30 bg-progress-subtle/60 p-3 text-left transition-all hover:border-progress/60 hover:bg-progress-subtle focus-visible:ring-2 focus-visible:ring-focus-ring cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-progress text-on-primary shadow-xs">
                    <Icon name="circle-check" size={16} />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-title-md font-semibold text-ink group-hover:text-progress transition-colors">
                      ⚡ Truy cập nhanh 1-Click
                    </span>
                    <span className="text-caption text-muted">
                      Tự động điền demo@local & vào không gian làm việc
                    </span>
                  </div>
                </div>
                <Icon
                  name="arrow-right"
                  size={16}
                  className="text-muted transition-all group-hover:translate-x-0.5 group-hover:text-progress"
                />
              </button>

              <div className="relative my-0.5 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-hairline" />
                </div>
                <span className="relative bg-surface-soft px-3 text-overline font-semibold uppercase text-muted">
                  Hoặc tự nhập tài khoản
                </span>
              </div>
            </div>
          ) : null}

          {/* Email input */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-title-md font-semibold text-ink">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={failed || undefined}
              aria-describedby={
                cn(failed && errorId, mode === "fixture" && "email-hint") ||
                undefined
              }
              className={cn(inputClass, failed && "border-danger")}
            />
            {mode === "fixture" ? (
              <span id="email-hint" className="text-caption text-muted">
                Tài khoản demo local: <code className="font-mono text-ink">demo@local</code>
              </span>
            ) : null}
          </div>

          {/* Password input */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-title-md font-semibold text-ink">
              Mật khẩu
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Nhập mật khẩu…"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={failed || undefined}
                aria-describedby={
                  cn(
                    failed && errorId,
                    mode === "fixture" && "password-hint",
                  ) || undefined
                }
                className={cn(inputClass, "pr-12", failed && "border-danger")}
              />
              <button
                type="button"
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-1.5 top-1.5 flex size-9 items-center justify-center rounded-sm text-muted transition-colors hover:text-ink cursor-pointer"
              >
                <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
              </button>
            </div>
            {mode === "fixture" ? (
              <span id="password-hint" className="text-caption text-muted">
                Bản mô phỏng chấp nhận mật khẩu bất kỳ.
              </span>
            ) : null}
          </div>

          {/* Utility row: Remember me & Enter key hint */}
          <div className="flex items-center justify-between pt-0.5 text-body-sm">
            <label className="flex items-center gap-2 cursor-pointer text-muted hover:text-ink select-none">
              <input
                type="checkbox"
                name="remember"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="size-4 rounded-xs border-border-control text-primary accent-primary cursor-pointer"
              />
              <span>Ghi nhớ phiên làm việc</span>
            </label>
            <span className="hidden sm:inline-block text-caption text-muted">
              Nhấn <kbd className="rounded border border-hairline bg-surface-strong px-1.5 py-0.5 font-mono text-[11px] text-ink">Enter ↵</kbd>
            </span>
          </div>

          {/* SSO button for live mode */}
          {mode === "live" ? (
            <Button
              type="button"
              block
              variant="secondary"
              onClick={startOidc}
              aria-label="SSO qua tổ chức (OIDC)"
              className="h-12 border-hairline font-medium hover:bg-surface-strong"
            >
              <span className="flex items-center justify-center gap-2">
                <Icon name="shield-check" size={18} className="text-planner" />
                <span>Đăng nhập SSO qua tổ chức (OIDC)</span>
              </span>
            </Button>
          ) : null}

          {/* Primary Submit CTA */}
          <Button
            type="submit"
            block
            disabled={login.isPending}
            aria-busy={login.isPending}
            className="mt-1 h-12 text-body-md font-semibold shadow-sm cursor-pointer"
          >
            {login.isPending ? "Đang đăng nhập…" : "Đăng nhập"}
          </Button>
        </form>

        {/* Safety pledge under card */}
        <div className="mt-4 flex items-center justify-center gap-2 text-center text-caption text-muted">
          <Icon name="shield-check" size={15} className="text-action shrink-0" />
          <span>Phân tích trước (Dry-run) · Chỉ ghi dữ liệu khi bạn phê duyệt</span>
        </div>
      </main>

      {/* Page Footer */}
      <footer className="relative z-10 border-t border-hairline/60 py-3 text-center text-caption text-muted">
        <div className="mx-auto flex max-w-content flex-col items-center justify-center gap-1 sm:flex-row sm:gap-4 px-4">
          <span>© 2026 AI Automation Platform</span>
          <span className="hidden sm:inline text-hairline-soft">·</span>
          <span>Local-first Architecture</span>
          <span className="hidden sm:inline text-hairline-soft">·</span>
          <span>Quyền riêng tư & An toàn dữ liệu</span>
        </div>
      </footer>
    </div>
  );
}
