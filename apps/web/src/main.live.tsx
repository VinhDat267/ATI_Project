import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { createHttpTransport } from "./core/api.js";
import { createSession } from "./core/session.js";

export function bootstrap(): void {
  const rootElement = document.getElementById("app");
  if (!rootElement) {
    throw new Error("Root element #app not found");
  }

  const session = createSession();
  const transport = createHttpTransport({
    mode: "hybrid",
    getToken: () => session.getToken(),
  });

  createRoot(rootElement).render(
    <StrictMode>
      <App transport={transport} session={session} mode="live" />
    </StrictMode>,
  );
}
