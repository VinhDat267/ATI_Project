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
  "h-14 w-full rounded-sm border border-border-control bg-canvas px-4 text-body-md text-ink outline-none transition-colors placeholder:text-muted focus-visible:border-ink focus-visible:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ink/10";

/**
 * Sign-in View (V01 - DESIGN.md).
 * Clean Airtable-inspired layout:
 * - No fake top nav, no blur-3xl ambient glows
 * - 2-column layout (Introduction + Form card 420px) on desktop (1120px max)
 * - Mobile-first DOM ordering (Form first, Intro second)
 * - 56px inputs with 40px password toggle circle
 * - Selective 401 field invalidation
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
  const isFieldInvalid =
    failed && login.error instanceof ClientError && login.error.status === 401;

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
    <div className="relative flex min-h-dvh flex-col justify-between overflow-x-hidden bg-canvas px-6 py-6 desk:px-8 desk:py-8">
      {/* Header Area */}
      <header className="mx-auto flex w-full max-w-[1120px] items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-soft px-3 py-0.5 text-caption font-medium text-muted">
            <span className="size-2 rounded-full bg-success" />
            <span>Hệ thống nội bộ</span>
          </span>
          {mode === "fixture" ? (
            <span className="inline-flex h-6 items-center rounded-full border border-demo/10 bg-demo-subtle px-2.5 text-badge text-demo">
              Dữ liệu mô phỏng
            </span>
          ) : null}
        </div>
      </header>

      {/* Main 2-column Container */}
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col justify-center py-6 desk:py-10"
      >
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_420px] lg:gap-16">
          {/* Form Card: order-1 on mobile, order-2 on desktop (lg) */}
          <form
            aria-labelledby="login-title"
            onSubmit={submit}
            noValidate
            className="order-1 mx-auto flex w-full max-w-[420px] flex-col gap-4 rounded-[14px] border border-hairline bg-surface-soft p-7 shadow-card desk:p-8 lg:order-2 lg:mx-0"
          >
            {/* Card Header */}
            <div className="flex flex-col gap-1">
              <h1
                id="login-title"
                className="m-0 text-headline-sm font-semibold text-ink"
              >
                Đăng nhập
              </h1>
              <p className="m-0 text-body-sm text-muted">
                Truy cập không gian làm việc của bạn
              </p>
            </div>

            {/* Error Banner */}
            {failed && errorMessage ? (
              <p
                id={errorId}
                role="alert"
                className="m-0 rounded-[14px] border border-danger/20 bg-danger-subtle p-3.5 text-body-md text-danger"
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
                  aria-label="Trải nghiệm nhanh 1-Click với tài khoản dùng thử"
                  className="group flex w-full cursor-pointer items-center justify-between rounded-md border border-progress/30 bg-progress-subtle/60 p-3 text-left transition-all hover:border-progress/60 hover:bg-progress-subtle focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-progress text-on-primary shadow-xs">
                      <Icon name="circle-check" size={16} />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-title-md font-semibold text-ink transition-colors group-hover:text-progress">
                        ⚡ Trải nghiệm nhanh 1-Click
                      </span>
                      <span className="text-caption text-muted">
                        Đăng nhập ngay với tài khoản mẫu để dùng thử
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
                    Hoặc đăng nhập bằng tài khoản của bạn
                  </span>
                </div>
              </div>
            ) : null}

            {/* Email input */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                className="text-title-md font-semibold text-ink"
              >
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
                aria-invalid={isFieldInvalid || undefined}
                aria-describedby={
                  cn(
                    isFieldInvalid && errorId,
                    mode === "fixture" && "email-hint",
                  ) || undefined
                }
                className={cn(inputClass, isFieldInvalid && "border-danger")}
              />
              {mode === "fixture" ? (
                <span id="email-hint" className="text-caption text-muted">
                  Tài khoản dùng thử:{" "}
                  <code className="font-mono text-ink">demo@local</code>
                </span>
              ) : null}
            </div>

            {/* Password input */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="password"
                className="text-title-md font-semibold text-ink"
              >
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
                  aria-invalid={isFieldInvalid || undefined}
                  aria-describedby={
                    cn(
                      isFieldInvalid && errorId,
                      mode === "fixture" && "password-hint",
                    ) || undefined
                  }
                  className={cn(
                    inputClass,
                    "pr-14",
                    isFieldInvalid && "border-danger",
                  )}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-2 flex size-10 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
                >
                  <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
                </button>
              </div>
              {mode === "fixture" ? (
                <span id="password-hint" className="text-caption text-muted">
                  Chế độ dùng thử: Chấp nhận mật khẩu bất kỳ.
                </span>
              ) : null}
            </div>

            {/* Utility row: Remember me & Enter key hint */}
            <div className="flex items-center justify-between pt-0.5 text-body-sm">
              <label className="flex cursor-pointer select-none items-center gap-2 text-muted hover:text-ink">
                <input
                  type="checkbox"
                  name="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="size-4 cursor-pointer rounded-xs border-border-control text-primary accent-primary"
                />
                <span>Ghi nhớ phiên làm việc</span>
              </label>
              <span className="hidden text-caption text-muted sm:inline-block">
                Nhấn{" "}
                <kbd className="rounded border border-hairline bg-surface-strong px-1.5 py-0.5 font-mono text-mono-sm text-ink">
                  Enter ↵
                </kbd>
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
                  <Icon
                    name="shield-check"
                    size={18}
                    className="text-planner"
                  />
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
              className="mt-1 h-12 cursor-pointer text-body-md font-semibold shadow-sm"
            >
              {login.isPending ? "Đang đăng nhập…" : "Đăng nhập"}
            </Button>

            {/* Card Bottom Note */}
            <div className="mt-1 flex items-center justify-center gap-1.5 border-t border-hairline pt-3 text-center text-caption text-muted">
              <Icon
                name="shield-check"
                size={15}
                className="shrink-0 text-action"
              />
              <span>Kiểm soát an toàn · Chỉ cập nhật dữ liệu khi bạn phê duyệt</span>
            </div>
          </form>

          {/* Introduction Section: order-2 on mobile, order-1 on desktop (lg) */}
          <section
            aria-labelledby="intro-title"
            className="order-2 flex flex-col justify-center lg:order-1"
          >
            <h2
              id="intro-title"
              className="m-0 text-display-md-mobile font-semibold text-ink desk:text-display-md"
            >
              Tự động hoá quy trình làm việc thông minh và an toàn
            </h2>
            <p className="mt-4 max-w-[560px] text-body-lg text-muted">
              Trợ lý AI giúp nhóm tự động phân công công việc, tổng hợp báo cáo và đồng bộ tiến độ. Mọi thay đổi dữ liệu đều được bạn xem trước và phê duyệt trước khi thực hiện.
            </p>
            <div className="mt-8 flex flex-col gap-6">
              {/* Step 1 */}
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-strong text-ink">
                  <Icon name="sparkles" size={22} />
                </div>
                <div className="flex flex-col">
                  <span className="text-body-lg font-medium text-ink">
                    Giao việc bằng ngôn ngữ tự nhiên
                  </span>
                  <span className="mt-0.5 text-body-sm text-muted">
                    Chỉ cần nêu yêu cầu, trợ lý AI sẽ tự động phân tích và đề xuất các bước thực hiện rõ ràng.
                  </span>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-strong text-ink">
                  <Icon name="shield-check" size={22} />
                </div>
                <div className="flex flex-col">
                  <span className="text-body-lg font-medium text-ink">
                    Xem trước kết quả trước khi cập nhật
                  </span>
                  <span className="mt-0.5 text-body-sm text-muted">
                    Kiểm tra chi tiết nội dung sẽ thay đổi; hệ thống chỉ tiến hành khi nhận được sự đồng ý của bạn.
                  </span>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-strong text-ink">
                  <Icon name="history" size={22} />
                </div>
                <div className="flex flex-col">
                  <span className="text-body-lg font-medium text-ink">
                    Theo dõi tiến độ & lịch sử minh bạch
                  </span>
                  <span className="mt-0.5 text-body-sm text-muted">
                    Lưu trữ đầy đủ kết quả và lịch sử xử lý, giúp nhóm dễ dàng rà soát và nắm bắt mọi hoạt động.
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Page Footer */}
      <footer className="mx-auto flex w-full max-w-[1120px] flex-col items-center justify-between gap-2 border-t border-hairline/60 pt-4 text-caption text-muted sm:flex-row">
        <span>© 2026 AI Automation Platform</span>
        <span>Bảo mật thông tin & Quyền riêng tư · Dữ liệu được bảo vệ an toàn</span>
      </footer>
    </div>
  );
}
