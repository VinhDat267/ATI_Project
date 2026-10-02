/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { LandingPageView } from "../../src/components/LandingPageView";
afterEach(cleanup);
describe("Approved B landing page", () => {
  it("opens the inline roadmap and closes it with Escape without navigation", () => {
    const login = vi.fn();
    render(<LandingPageView onGoToLogin={login} />);
    const toggle = screen.getByRole("button", { name: /Roadmap/ });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(within(panel).getByText("Đã tích hợp")).toBeInTheDocument();
    expect(within(panel).getByText("Đang lên kế hoạch")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Chưa thể cấu hình");
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(panel).not.toBeVisible();
    expect(login).not.toHaveBeenCalled();
  });
  it("announces the three integrations once while decorative copies loop", () => {
    render(<LandingPageView onGoToLogin={vi.fn()} />);
    const services = screen.getByRole("region", { name: "Các dịch vụ đã có tích hợp" });
    expect(within(services).getAllByRole("listitem")).toHaveLength(3);
  });

  it("opens authentication from the primary CTA", () => {
    const login = vi.fn();
    render(<LandingPageView onGoToLogin={login} />);
    screen.getAllByRole("button", { name: /Bắt đầu cùng ATI/ }).forEach((button) => fireEvent.click(button));
    expect(login).toHaveBeenCalledTimes(2);
    expect(screen.getByText("VÍ DỤ MINH HỌA")).toBeInTheDocument();
  });
  it("has valid section links and distinguishes integrations from roadmap", () => {
    const { container } = render(<LandingPageView onGoToLogin={vi.fn()} />);
    container
      .querySelectorAll<HTMLAnchorElement>('a[href^="#"]')
      .forEach((link) =>
        expect(container.querySelector(link.hash)).not.toBeNull(),
      );
    const services = container.querySelector(".service-strip")!;
    expect(services.textContent).toMatch(/GitHub.*Trello.*Slack/);
    expect(services.textContent).not.toContain("Google Sheets");
    expect(container.querySelector(".roadmap-section")).toHaveTextContent(
      "Roadmap",
    );
    expect(container.querySelector(".roadmap-section")).toHaveTextContent(
      "Google Sheets",
    );
    expect(
      screen.queryByText(/Bảo vệ dữ liệu tuyệt đối|8 bước|99%/),
    ).toBeNull();
  });
});
