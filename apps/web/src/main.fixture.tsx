import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { createFixtureTransport } from "./core/fixtures.js";
import { createSession } from "./core/session.js";

export function bootstrap(): void {
  const rootElement = document.getElementById("app");
  if (!rootElement) {
    throw new Error("Root element #app not found");
  }

  const scenario =
    new URLSearchParams(window.location.search).get("scenario") ?? undefined;
  const transport = createFixtureTransport(scenario);
  const session = createSession();

  Object.defineProperty(window, "__WAP_FIXTURE_CALLS__", {
    configurable: true,
    value: transport.calls,
  });

  createRoot(rootElement).render(
    <StrictMode>
      <App
        transport={transport}
        session={session}
        mode="fixture"
        hints={transport}
      />
    </StrictMode>,
  );
}
