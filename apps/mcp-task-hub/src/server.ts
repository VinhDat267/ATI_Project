import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { openDatabase, G1_DATABASE_URL, DEMO_USER_ID } from "@wap/db";
import { toolDefinitions, EnabledToolNameSchema } from "./contracts.js";
import { TaskHub, ToolError } from "./service.js";

const connection = openDatabase(process.env.G1_DATABASE_URL ?? G1_DATABASE_URL);
const principal = z.uuid().parse(process.env.G1_USER_ID ?? DEMO_USER_ID);
const hub = new TaskHub(connection, principal);
const server = new Server(
  { name: "ati-task-hub-local", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions(),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const name = EnabledToolNameSchema.parse(request.params.name);
    const result = await hub.call(
      name,
      request.params.arguments ?? {},
      request.params._meta?.["ati/authorization"],
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result.output) }],
      structuredContent: result.output,
      _meta: { "ati/receipt_replayed": result.replayed },
    };
  } catch (error) {
    const code =
      error instanceof ToolError
        ? error.code
        : error instanceof z.ZodError
          ? "BAD_ARGS"
          : "INTERNAL_ERROR";
    const message =
      error instanceof ToolError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : "Local tool failed; inspect the server error code";
    if (code === "INTERNAL_ERROR") console.error("task_hub: INTERNAL_ERROR");
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ code, message }) }],
    };
  }
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  await connection.close();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
process.stdin.once("end", () => void close());
await server.connect(new StdioServerTransport());
