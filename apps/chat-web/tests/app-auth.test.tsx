/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "../src/App";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("App authentication", () => {
  it("requires submitted credentials instead of logging in as the demo admin automatically", async () => {
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => url==='/api/auth/config'?{signupEnabled:true,googleEnabled:false}:({
        accessToken: "jwt",
        user: { id: "user-1", email: "operator@example.com", name: "Operator" },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App initialView="login" />);

    await screen.findByRole('button',{name:/Tạo tài khoản/});
    expect(fetchMock.mock.calls.every(([url])=>url==='/api/auth/config')).toBe(true);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "operator@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), {
      target: { value: "entered-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/login",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "operator@example.com",
            password: "entered-secret",
          }),
        }),
      ),
    );
  });
});
