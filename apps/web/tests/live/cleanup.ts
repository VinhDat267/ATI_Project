import net from "node:net";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { preview, type PreviewServer } from "vite";

const adminUrl =
  process.env.API_TEST_ADMIN_URL ??
  "postgresql://wap:wap@127.0.0.1:55432/wap_g1";

export interface ApiFixture {
  baseUrl: string;
  databaseUrl: string;
  email: string;
  password: string;
  b02Prompt: string;
  login(): Promise<string>;
  call(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface LiveFixtureContext {
  api: ApiFixture;
  previewServer: PreviewServer;
  previewUrl: string;
  apiUrl: string;
  apiPort: number;
  previewPort: number;
  dbName: string;
  databaseUrl: string;
  email: string;
  password: string;
  b02Prompt: string;
}

export interface LiveFixtureOptions {
  makeApiFixture?: (options?: {
    workerEnabled?: boolean;
    plannerMode?: "disabled" | "dev_fixture" | "ai";
    filesystemEnabled?: boolean;
  }) => Promise<ApiFixture>;
  startPreview?: (options: {
    root: string;
    configFile: string;
    mode: string;
    preview: {
      host: string;
      port: number;
      strictPort: boolean;
    };
  }) => Promise<PreviewServer>;
}

export async function createLiveFixture(
  options: LiveFixtureOptions = {},
): Promise<LiveFixtureContext> {
  let makeApi = options.makeApiFixture;
  if (!makeApi) {
    const fixtureModule = "../../../api/tests/fixture.js";
    const { makeApiFixture } = (await import(fixtureModule)) as {
      makeApiFixture: (options?: {
        workerEnabled?: boolean;
        plannerMode?: "disabled" | "dev_fixture" | "ai";
        filesystemEnabled?: boolean;
      }) => Promise<ApiFixture>;
    };
    makeApi = makeApiFixture;
  }

  const startPreview = options.startPreview ?? preview;

  const envSnapshot = {
    WAP_API_TARGET: process.env.WAP_API_TARGET,
    WAP_PREVIEW_ORIGIN: process.env.WAP_PREVIEW_ORIGIN,
    WAP_PREVIEW_PORT: process.env.WAP_PREVIEW_PORT,
  };

  const restoreEnv = (): void => {
    if (envSnapshot.WAP_API_TARGET === undefined) {
      delete process.env.WAP_API_TARGET;
    } else {
      process.env.WAP_API_TARGET = envSnapshot.WAP_API_TARGET;
    }
    if (envSnapshot.WAP_PREVIEW_ORIGIN === undefined) {
      delete process.env.WAP_PREVIEW_ORIGIN;
    } else {
      process.env.WAP_PREVIEW_ORIGIN = envSnapshot.WAP_PREVIEW_ORIGIN;
    }
    if (envSnapshot.WAP_PREVIEW_PORT === undefined) {
      delete process.env.WAP_PREVIEW_PORT;
    } else {
      process.env.WAP_PREVIEW_PORT = envSnapshot.WAP_PREVIEW_PORT;
    }
  };

  let api: ApiFixture | null = null;
  let previewServer: PreviewServer | null = null;

  const cleanupPartial = async (originalError: unknown): Promise<never> => {
    restoreEnv();
    const cleanupErrors: unknown[] = [];

    if (previewServer) {
      try {
        await previewServer.close();
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    if (api) {
      try {
        await api.close();
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    if (cleanupErrors.length > 0) {
      const origMsg =
        originalError instanceof Error
          ? originalError.message
          : String(originalError);
      const cleanMsgs = cleanupErrors
        .map((e) => (e instanceof Error ? e.message : String(e)))
        .join("; ");
      const combined = new Error(`${origMsg} (Cleanup errors: ${cleanMsgs})`);
      (combined as any).cause = originalError;
      throw combined;
    }

    throw originalError;
  };

  try {
    // 1. Launch backend API fixture
    api = await makeApi({
      workerEnabled: true,
      plannerMode: "dev_fixture",
      filesystemEnabled: false,
    });

    const apiUrl = api.baseUrl;
    const apiTargetUrl = new URL(apiUrl);
    const apiPort = Number(apiTargetUrl.port);
    const dbName = new URL(api.databaseUrl).pathname.slice(1);

    // Set environment variables for Vite preview and localProxy
    process.env.WAP_API_TARGET = apiTargetUrl.origin;
    delete process.env.WAP_PREVIEW_ORIGIN;
    process.env.WAP_PREVIEW_PORT = "0";

    // 2. Start Vite preview server on an isolated dynamic port
    const webRoot = fileURLToPath(new URL("../../", import.meta.url));
    const configPath = fileURLToPath(
      new URL("../../vite.config.ts", import.meta.url),
    );

    previewServer = await startPreview({
      root: webRoot,
      configFile: configPath,
      mode: "live",
      preview: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
      },
    });

    const previewAddress = previewServer.httpServer?.address();
    if (
      !previewAddress ||
      typeof previewAddress !== "object" ||
      typeof previewAddress.port !== "number"
    ) {
      throw new Error("Failed to obtain dynamic port for Vite preview server");
    }

    const previewPort = previewAddress.port;
    const previewUrl = `http://127.0.0.1:${previewPort}`;

    return {
      api,
      previewServer,
      previewUrl,
      apiUrl,
      apiPort,
      previewPort,
      dbName,
      databaseUrl: api.databaseUrl,
      email: api.email,
      password: api.password,
      b02Prompt: api.b02Prompt,
    };
  } catch (err) {
    return await cleanupPartial(err);
  }
}

export async function safeTeardown(fixture: LiveFixtureContext): Promise<void> {
  let previewErr: unknown = null;
  let apiErr: unknown = null;

  try {
    await fixture.previewServer.close();
  } catch (err) {
    previewErr = err;
  }

  try {
    await fixture.api.close();
  } catch (err) {
    apiErr = err;
  }

  if (previewErr || apiErr) {
    const msgs: string[] = [];
    if (previewErr)
      msgs.push(
        `Preview close error: ${
          previewErr instanceof Error ? previewErr.message : String(previewErr)
        }`,
      );
    if (apiErr)
      msgs.push(
        `API close error: ${
          apiErr instanceof Error ? apiErr.message : String(apiErr)
        }`,
      );
    throw new Error(msgs.join("; "));
  }
}

export async function assertDatabaseDropped(
  dbName: string,
  adminConnectionUrl = adminUrl,
): Promise<boolean> {
  const admin = postgres(adminConnectionUrl, {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const rows = await admin.unsafe(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName],
    );
    return rows.length === 0;
  } finally {
    await admin.end();
  }
}

export async function assertPortReleased(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const released = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(250);

      socket.on("connect", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("error", (err: any) => {
        socket.destroy();
        if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") {
          resolve(true);
        } else {
          resolve(true);
        }
      });

      socket.connect(port, host);
    });

    if (released) return true;
    await new Promise((r) => setTimeout(r, 100));
  }

  return false;
}
