import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RuntimeNotice } from "../../src/components/RuntimeNotice";

afterEach(cleanup);
describe("Runtime notice", () => {
  it("does not show a test or technical banner in live mode", () => {
    render(<RuntimeNotice mode="live" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("does not show the sandbox banner in the workspace", () => {
    render(<RuntimeNotice mode="sandbox" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it.each([undefined, "unknown", "unexpected"])("keeps the environment warning for %s", (mode) => {
    render(<RuntimeNotice mode={mode} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Chưa xác/);
  });
});
