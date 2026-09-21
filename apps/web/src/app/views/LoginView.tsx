import { useMutation } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import type { SessionController } from "../../core/session.js";
import type { Transport } from "../../core/contracts.js";
import { ClientError } from "../../core/errors.js";
import { cn } from "@/lib/cn";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { Logo } from "../shell/Logo";

const POINTS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "message",
    title: "Mô tả việc cần làm",
    body: "Bằng tiếng Việt hoặc tiếng Anh.",
  },
  {
    icon: "eye",
    title: "Xem trước đích và nội dung sẽ ghi",
    body: "Dữ liệu được đọc trước, chưa có gì bị ghi.",
  },
  {
    icon: "shield-check",
    title: "Duyệt, rồi xem kết quả và chứng cứ",
    body: "Chỉ bản xem trước bạn duyệt mới được thực hiện.",
  },
];

const inputClass =
  "h-14 w-full rounded-sm border border-border-control bg-canvas px-4 text-body-lg outline-none focus-visible:border-2 focus-visible:border-ink focus-visible:outline-none";

/** V01 — one outline at every width: H1 “Đăng nhập”, form first in the DOM. */
export function LoginView({
  transport,
  session,
  mode,
  onSignedIn,
}: {
  transport: Transport;
  session: SessionController;
  mode: "fixture" | "live";
  onSignedIn(email: string): void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between px-6 desk:h-20 xl:px-0">
          <Logo />
          {mode === "fixture" ? (
            <span className="inline-flex h-6.5 items-center rounded-full bg-demo-subtle px-2.5 text-badge text-demo">
              Dữ liệu mô phỏng
            </span>
          ) : null}
        </div>
      </header>
      <main
        id="main-content"
        className="mx-auto grid max-w-content gap-12 px-6 py-10 desk:grid-cols-2 desk:gap-18 desk:py-16 xl:px-0"
      >
        <form
          aria-labelledby="login-title"
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-5 rounded-md border border-hairline p-6 shadow-card desk:col-start-2 desk:row-start-1 desk:p-8"
        >
          <h1
            id="login-title"
            className="m-0 text-display-md-mobile desk:text-display-md"
          >
            Đăng nhập
          </h1>
          {failed && errorMessage ? (
            <p
              id={errorId}
              role="alert"
              className="m-0 rounded-sm bg-danger-subtle p-3 text-body-md text-danger"
            >
              {errorMessage}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-title-md">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
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
              <span id="email-hint" className="text-body-sm text-muted">
                Tài khoản demo local
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="text-title-md">
              Mật khẩu
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={failed || undefined}
                aria-describedby={
                  cn(
                    failed && errorId,
                    mode === "fixture" && "password-hint",
                  ) || undefined
                }
                className={cn(inputClass, "pr-14", failed && "border-danger")}
              />
              <button
                type="button"
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-1.5 top-1.5 flex size-11 items-center justify-center rounded-sm"
              >
                <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
              </button>
            </div>
            {mode === "fixture" ? (
              <span id="password-hint" className="text-body-sm text-muted">
                Bản mô phỏng chấp nhận mật khẩu bất kỳ.
              </span>
            ) : null}
          </div>
          {mode === "live" ? (
            <Button type="button" block variant="secondary" onClick={startOidc}>
              SSO qua tổ chức
            </Button>
          ) : null}
          <Button
            type="submit"
            block
            disabled={login.isPending}
            aria-busy={login.isPending}
          >
            {login.isPending ? "Đang đăng nhập…" : "Đăng nhập"}
          </Button>
        </form>

        <section className="flex max-w-measure-sm flex-col gap-5 desk:col-start-1 desk:row-start-1">
          <span className="text-body-sm text-muted">
            Chạy cục bộ trên máy này
            {mode === "fixture" ? " · Kế hoạch mẫu" : ""}
          </span>
          <h2 className="m-0 text-headline-sm-mobile desk:text-display-md">
            Lập kế hoạch tự động, ghi dữ liệu chỉ khi bạn duyệt
          </h2>
          <p className="m-0 text-body-lg text-muted">
            ATI biến mô tả công việc thành kế hoạch gọi công cụ local, cho bạn
            xem trước từng thao tác ghi rồi mới thực hiện.
          </p>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-strong">
                  <Icon name={point.icon} size={18} />
                </span>
                <span className="flex flex-col">
                  <span className="text-title-md">{point.title}</span>
                  <span className="text-body-sm text-muted">{point.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
