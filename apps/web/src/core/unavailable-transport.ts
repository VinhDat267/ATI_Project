import type { Transport } from "./contracts.js";

const unavailable = async (): Promise<never> => {
  throw new Error("Live transport chưa được nối trong WEB-01B");
};

export function createUnavailableTransport(): Transport {
  return {
    login: unavailable,
    me: unavailable,
    logout: unavailable,
    startOidcLogin: unavailable,
    list: unavailable,
    servers: unavailable,
    create: unavailable,
    detail: unavailable,
    events: unavailable,
    decide: unavailable,
    cancel: unavailable,
    trace: unavailable,
    reconciliation: unavailable,
  };
}
