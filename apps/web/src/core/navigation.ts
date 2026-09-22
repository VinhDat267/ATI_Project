export type Route =
  | { page: "login" | "overview" | "new" | "history" | "tools" | "pilot-new" }
  | { page: "run"; id: string }
  | { page: "pilot-run"; id: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function isUuid(value: string): boolean {
  return value.toLowerCase() === NIL_UUID || UUID_PATTERN.test(value);
}

export function parseRoute(hash: string): Route {
  switch (hash) {
    case "#/login":
      return { page: "login" };
    case "#/overview":
      return { page: "overview" };
    case "#/new":
      return { page: "new" };
    case "#/pilot":
    case "#/pilot/new":
      return { page: "pilot-new" };
    case "#/runs":
      return { page: "history" };
    case "#/tools":
      return { page: "tools" };
    default: {
      const pilotPrefix = "#/pilot/runs/";
      if (hash.startsWith(pilotPrefix)) {
        const id = hash.slice(pilotPrefix.length);
        if (isUuid(id)) {
          return { page: "pilot-run", id };
        }
      }
      const prefix = "#/runs/";
      if (hash.startsWith(prefix)) {
        const id = hash.slice(prefix.length);
        if (isUuid(id)) {
          return { page: "run", id };
        }
      }
      return { page: "overview" };
    }
  }
}

export function routeToHash(route: Route): string {
  switch (route.page) {
    case "login":
      return "#/login";
    case "overview":
      return "#/overview";
    case "new":
      return "#/new";
    case "pilot-new":
      return "#/pilot/new";
    case "history":
      return "#/runs";
    case "tools":
      return "#/tools";
    case "run":
      if (!isUuid(route.id)) {
        throw new Error("Run route requires a canonical UUID");
      }
      return `#/runs/${route.id}`;
    case "pilot-run":
      if (!isUuid(route.id)) {
        throw new Error("Pilot run route requires a canonical UUID");
      }
      return `#/pilot/runs/${route.id}`;
    default: {
      const exhaustive: never = route;
      throw new Error(`Unknown route: ${String(exhaustive)}`);
    }
  }
}

export function navigate(route: Route, replace = false): void {
  const hash = routeToHash(route);
  if (typeof window === "undefined") {
    throw new Error("navigate requires a browser window");
  }
  if (replace) {
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new Event("hashchange"));
    return;
  }
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}
