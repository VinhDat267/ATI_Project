import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Transport } from "../core/contracts.js";
import { createDraftStore, type DraftStore } from "../core/draft.js";
import type { Route } from "../core/navigation.js";
import { navigate, parseRoute } from "../core/navigation.js";
import { shouldRetry } from "../core/queries.js";
import type { SessionController } from "../core/session.js";
import {
  AppProvider,
  createControllerRegistry,
  type AppHints,
} from "./context";
import { AppShell } from "./shell/AppShell";
import { HistoryView } from "./views/HistoryView";
import { LoginView } from "./views/LoginView";
import { NewRunView } from "./views/NewRunView";
import { OverviewView } from "./views/OverviewView";
import { RunView } from "./views/run/RunView";
import { ToolsView } from "./views/ToolsView";
import "./theme.css";

export interface AppProps {
  transport: Transport;
  session: SessionController;
  mode: "fixture" | "live";
  drafts?: DraftStore;
  hints?: AppHints;
}

const NO_HINTS: AppHints = { suggestedPrompt: () => null };

function currentRoute(): Route {
  if (typeof window === "undefined") return { page: "overview" };
  return parseRoute(window.location.hash || "#/overview");
}

function useHashRoute(): Route {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: true },
      // Writes are never retried automatically: a lost response is shown as
      // "chưa rõ" and the user re-reads state with a GET.
      mutations: { retry: 0 },
    },
  });
}

function RouteView({ route }: { route: Route }): ReactNode {
  switch (route.page) {
    case "overview":
    case "login":
      return <OverviewView />;
    case "new":
      return <NewRunView />;
    case "history":
      return <HistoryView />;
    case "tools":
      return <ToolsView />;
    case "run":
      return <RunView key={route.id} runId={route.id} />;
    default: {
      const exhaustive: never = route;
      return exhaustive;
    }
  }
}

export function App({
  transport,
  session,
  mode,
  drafts: providedDrafts,
  hints = NO_HINTS,
}: AppProps): ReactNode {
  const route = useHashRoute();
  const snapshot = useSyncExternalStore(
    session.store.subscribe,
    session.store.getSnapshot,
    session.store.getSnapshot,
  );
  // One query cache per session generation: a new session can never read the
  // previous one's server state, and the old cache is cancelled and dropped.
  const queryClient = useMemo(
    () => createQueryClient(),
    [snapshot.generation],
  );
  useEffect(
    () => () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    },
    [queryClient],
  );
  const [drafts] = useState(() => providedDrafts ?? createDraftStore());
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot.token) drafts.clear();
  }, [snapshot.token, drafts]);

  const controllers = useMemo(
    () => createControllerRegistry(transport, session),
    [transport, session, snapshot.generation],
  );
  useEffect(
    () => () => {
      controllers.clear();
    },
    [controllers],
  );

  const context = useMemo(
    () => ({
      transport,
      session,
      generation: snapshot.generation,
      email,
      drafts,
      hints,
      mode,
      controllers,
    }),
    [
      transport,
      session,
      snapshot.generation,
      email,
      drafts,
      hints,
      mode,
      controllers,
    ],
  );

  if (!snapshot.token) {
    return (
      <QueryClientProvider client={queryClient}>
        <LoginView
          transport={transport}
          session={session}
          mode={mode}
          onSignedIn={(signedInEmail) => {
            setEmail(signedInEmail);
            if (route.page === "login") navigate({ page: "overview" }, true);
          }}
        />
      </QueryClientProvider>
    );
  }

  const effective: Route = route.page === "login" ? { page: "overview" } : route;
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider value={context}>
        <AppShell route={effective}>
          <RouteView route={effective} />
        </AppShell>
      </AppProvider>
    </QueryClientProvider>
  );
}
