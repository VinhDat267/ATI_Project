import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Transport } from "../core/contracts.js";
import type { Route } from "../core/navigation.js";
import { navigate, parseRoute, routeToHash } from "../core/navigation.js";
import type { SessionController } from "../core/session.js";
import "./styles.css";

export interface AppProps {
  transport: Transport;
  session: SessionController;
  mode: "fixture" | "live";
}

const navigationItems: Array<{ route: Route; label: string }> = [
  { route: { page: "overview" }, label: "Tổng quan" },
  { route: { page: "new" }, label: "Tạo yêu cầu" },
  { route: { page: "history" }, label: "Lịch sử" },
  { route: { page: "tools" }, label: "Công cụ" },
];

function initialRoute(): Route {
  if (typeof window === "undefined") {
    return { page: "overview" };
  }
  return parseRoute(window.location.hash || "#/overview");
}

function useHashRoute(): Route {
  const [route, setRoute] = useState(initialRoute);
  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(parseRoute(window.location.hash || "#/overview"));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}

function routeTitle(route: Route): string {
  switch (route.page) {
    case "overview":
      return "Tổng quan";
    case "new":
      return "Tạo yêu cầu";
    case "history":
      return "Lịch sử lần chạy";
    case "tools":
      return "Công cụ & kết nối";
    case "run":
      return "Chi tiết lần chạy";
    case "login":
      return "Đăng nhập";
    default: {
      const exhaustive: never = route;
      return String(exhaustive);
    }
  }
}

function LoginRoute({
  transport,
  session,
}: Pick<AppProps, "transport" | "session">): ReactNode {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const scope = session.beginRequest();
    try {
      const token = await transport.login(email, password, scope.signal);
      if (!scope.isCurrent()) {
        return;
      }
      session.setToken(token);
      setPassword("");
      navigate({ page: "overview" }, true);
    } catch (cause) {
      if (
        scope.isCurrent() &&
        !(cause instanceof Error && cause.name === "AbortError")
      ) {
        setError(cause instanceof Error ? cause.message : "Đăng nhập thất bại");
        setPassword("");
      }
    } finally {
      scope.abort();
      if (scope.isCurrent() || !session.getToken()) {
        setPending(false);
      }
    }
  };

  return (
    <main className="login-page" id="main-content">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">ATI WORKFLOW PLATFORM</p>
        <h1 id="login-title">Đăng nhập</h1>
        <p className="muted">
          Đăng nhập để xem các lần chạy và bằng chứng thực thi của bạn.
        </p>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Mật khẩu</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button button-primary"
            type="submit"
            disabled={pending}
          >
            {pending ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>
      </section>
    </main>
  );
}

function PageContent({ route }: { route: Route }): ReactNode {
  if (route.page === "login") {
    return null;
  }
  if (route.page === "run") {
    return (
      <>
        <p className="muted">Mã lần chạy</p>
        <code className="run-id">{route.id}</code>
        <div className="empty-panel">
          <strong>Đang chờ dữ liệu</strong>
          <p>Chi tiết và tiến trình sẽ được nối ở WEB-02.</p>
        </div>
      </>
    );
  }

  const content: Record<
    Exclude<Route["page"], "login" | "run">,
    { summary: string; detail: string }
  > = {
    overview: {
      summary: "Theo dõi các lần chạy và quyết định cần xử lý.",
      detail: "Chưa có dữ liệu tải trong checkpoint này.",
    },
    new: {
      summary: "Mô tả công việc để hệ thống lập kế hoạch.",
      detail: "Biểu mẫu tạo yêu cầu sẽ được nối ở WEB-01C.",
    },
    history: {
      summary: "Tra cứu các lần chạy trước đây.",
      detail: "Bộ lọc và danh sách lịch sử sẽ được nối ở WEB-01C.",
    },
    tools: {
      summary: "Xem trạng thái các kết nối được duyệt.",
      detail: "Trạng thái công cụ sẽ được tải qua Transport ở WEB-01C.",
    },
  };
  const selected = content[route.page];
  return (
    <>
      <p className="lead">{selected.summary}</p>
      <div className="empty-panel">
        <strong>Workspace mô phỏng</strong>
        <p>{selected.detail}</p>
      </div>
    </>
  );
}

function AppShell({
  route,
  mode,
  session,
  children,
}: {
  route: Route;
  mode: AppProps["mode"];
  session: SessionController;
  children: ReactNode;
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const sessionSnapshot = useSyncExternalStore(
    session.store.subscribe,
    session.store.getSnapshot,
    session.store.getSnapshot,
  );

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) {
      navigationRef.current?.querySelector<HTMLElement>("a")?.focus();
    }
  }, [menuOpen]);

  const signOut = (): void => {
    session.clear();
    setMenuOpen(false);
    navigate({ page: "login" }, true);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Bỏ qua đến nội dung chính
      </a>
      <header className="topbar">
        <a
          className="brand"
          href={routeToHash({ page: "overview" })}
          onClick={() => navigate({ page: "overview" })}
        >
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>ATI Workflow</span>
        </a>
        <button
          ref={menuButtonRef}
          className="menu-button"
          type="button"
          aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <nav
          ref={navigationRef}
          id="primary-navigation"
          className={
            menuOpen ? "primary-navigation is-open" : "primary-navigation"
          }
          aria-label="Điều hướng chính"
        >
          {navigationItems.map(({ route: itemRoute, label }) => {
            const active =
              route.page === itemRoute.page ||
              (route.page === "run" && itemRoute.page === "history");
            return (
              <a
                key={itemRoute.page}
                href={routeToHash(itemRoute)}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(itemRoute);
                  setMenuOpen(false);
                }}
              >
                {label}
              </a>
            );
          })}
          <button type="button" className="sign-out" onClick={signOut}>
            Đăng xuất
          </button>
        </nav>
      </header>
      <div className="workspace-bar">
        <span className="mode-badge" data-testid="mode-banner">
          {mode === "fixture" ? "Dữ liệu mô phỏng" : "Chế độ kết nối thật"}
        </span>
        <span className="session-indicator">Phiên đang hoạt động</span>
        <span className="generation">v{sessionSnapshot.generation}</span>
      </div>
      <main className="content" id="main-content" tabIndex={-1}>
        <div className="page-heading">
          <p className="eyebrow">WORKSPACE</p>
          <h1>{routeTitle(route)}</h1>
        </div>
        {children}
      </main>
    </div>
  );
}

export function App({ transport, session, mode }: AppProps): ReactNode {
  const route = useHashRoute();
  const sessionSnapshot = useSyncExternalStore(
    session.store.subscribe,
    session.store.getSnapshot,
    session.store.getSnapshot,
  );

  useEffect(() => {
    if (!sessionSnapshot.token && route.page !== "login") {
      navigate({ page: "login" }, true);
    }
  }, [route.page, sessionSnapshot.token]);

  if (!sessionSnapshot.token) {
    return <LoginRoute transport={transport} session={session} />;
  }

  const effectiveRoute =
    route.page === "login" ? { page: "overview" as const } : route;
  return (
    <AppShell route={effectiveRoute} mode={mode} session={session}>
      <PageContent route={effectiveRoute} />
    </AppShell>
  );
}
