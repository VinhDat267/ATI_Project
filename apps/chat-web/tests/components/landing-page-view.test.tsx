/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { LandingPageView } from "../../src/components/LandingPageView";
afterEach(()=>{cleanup();vi.restoreAllMocks();window.history.replaceState({},'', '/');});
describe("Approved B landing page", () => {
  it('restores a direct service anchor after React mounts and exposes a functional service CTA',()=>{
    window.history.replaceState({},'', '/?view=landing#services');
    const scroll=vi.fn();
    const original=HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView=scroll;
    const open=vi.fn();
    try {
      render(<LandingPageView onGoToLogin={vi.fn()} onGoToServices={open}/>);
      expect(scroll).toHaveBeenCalledWith({behavior:'instant'});
      const services=document.getElementById('services')!;
      expect(services).toHaveTextContent('Tìm repository');
      expect(within(services).getAllByText('VÍ DỤ')).toHaveLength(3);
      fireEvent.click(within(services).getByRole('button',{name:'Đăng nhập để kết nối'}));
      expect(open).toHaveBeenCalledOnce();
      expect(screen.getByRole('navigation',{name:'Điều hướng chính'}).querySelector('a[href="#services"]')).toBeTruthy();
    } finally {HTMLElement.prototype.scrollIntoView=original;}
  });
  it("opens the inline roadmap and closes it with Escape without navigation", () => {
    const login = vi.fn();
    render(<LandingPageView onGoToLogin={login} />);
    const toggle = screen.getByRole("button", { name: /Dự kiến/ });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(within(panel).getByText("Đã tích hợp")).toBeInTheDocument();
    expect(within(panel).getByText("Đang lên kế hoạch")).toBeInTheDocument();
    expect(panel).toHaveTextContent("chưa khả dụng");
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
    screen.getAllByRole("button", { name: /Bắt đầu cùng Planora/ }).forEach((button) => fireEvent.click(button));
    expect(login).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Ví dụ quy trình")).toBeInTheDocument();
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
      "Dự kiến",
    );
    expect(container.querySelector(".roadmap-section")).toHaveTextContent(
      "Google Sheets",
    );
    expect(
      screen.queryByText(/Bảo vệ dữ liệu tuyệt đối|8 bước|99%/),
    ).toBeNull();
  });
});
