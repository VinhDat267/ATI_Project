import { EngineError, type Gateway } from "@wap/engine";

/** Read endpoints do not launch MCP. Execution opens a reviewed connection on demand. */
export function createGatewayManager(
  userId: string,
  open: () => Promise<Gateway>,
): Gateway {
  let current: Gateway | undefined;
  let pending: Promise<void> | undefined;
  return {
    userId,
    get tools() {
      return current?.tools ?? [];
    },
    async ensureConnected() {
      if (current && (current.isConnected?.() ?? true)) return;
      if (!pending)
        pending = (async () => {
          try {
            if (current) {
              const disconnected = current;
              current = undefined;
              await disconnected.close();
            }
            const gateway = await open();
            if (gateway.userId !== userId) {
              await gateway.close();
              throw new Error("Gateway owner mismatch");
            }
            current = gateway;
          } catch {
            throw new EngineError(
              "CONFIG",
              "Reviewed MCP connection is unavailable",
            );
          }
        })().finally(() => {
          pending = undefined;
        });
      await pending;
    },
    isConnected: () => Boolean(current && (current.isConnected?.() ?? true)),
    async assertCurrent() {
      if (!current)
        throw new EngineError(
          "CONFIG",
          "Reviewed MCP connection is unavailable",
        );
      await current.assertCurrent();
    },
    async call(...args) {
      if (!current)
        throw new EngineError(
          "CONFIG",
          "Reviewed MCP connection is unavailable",
        );
      return current.call(...args);
    },
    async close() {
      await pending?.catch(() => undefined);
      const gateway = current;
      current = undefined;
      await gateway?.close();
    },
  };
}
