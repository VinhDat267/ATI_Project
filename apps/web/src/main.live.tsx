import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { createSession } from "./core/session.js";
import { createUnavailableTransport } from "./core/unavailable-transport.js";

export function bootstrap(): void {
  const rootElement = document.getElementById("app");
  if (!rootElement) {
    throw new Error("Root element #app not found");
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App
        transport={createUnavailableTransport()}
        session={createSession()}
        mode="live"
      />
    </StrictMode>,
  );
}
