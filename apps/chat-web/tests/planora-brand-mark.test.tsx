/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { LandingPage } from '../src/pages/Landing/LandingPage';
import { MainNav } from '../src/components/layout/MainNav';
import { GuidePage } from '../src/pages/Guide/GuidePage';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { AuthActionPage } from '../src/pages/AuthAction/AuthActionPage';
import { NotFoundPage } from '../src/pages/NotFound/NotFoundPage';
import { apiClient } from '../src/services/api-client';

function assertVideoMarkSvg(root: ParentNode) {
  const svg = root.querySelector('svg[data-planora-mark="true"]');
  expect(svg).not.toBeNull();
  expect(svg).toHaveAttribute('aria-hidden', 'true');
  expect(svg).toHaveAttribute('viewBox', '0 0 100 100');

  const rect = svg?.querySelector('rect');
  const path = svg?.querySelector('path');
  const circle = svg?.querySelector('circle');

  expect(rect).not.toBeNull();
  expect(rect).toHaveAttribute('x', '14');
  expect(rect).toHaveAttribute('y', '10');
  expect(rect).toHaveAttribute('width', '22');
  expect(rect).toHaveAttribute('height', '80');
  expect(rect).toHaveAttribute('rx', '6');

  expect(path).not.toBeNull();
  expect(path).toHaveAttribute('d', 'M46 10 H65 A23 23 0 0 1 65 56 H46 Z');

  expect(circle).not.toBeNull();
  expect(circle).toHaveAttribute('cx', '68');
  expect(circle).toHaveAttribute('cy', '79');
  expect(circle).toHaveAttribute('r', '13');
}

describe('Planora brand mark & favicon (matches landing video)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'sandbox',
      gmailEnabled: false,
      mysheetsEnabled: false,
      mycalendarEnabled: false,
      schedulesEnabled: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('provides a dark squircle SVG favicon matching the 3-primitive video logo and links it from index.html', () => {
    const faviconPath = resolve(__dirname, '../public/favicon.svg');
    const faviconSvg = readFileSync(faviconPath, 'utf8');

    expect(faviconSvg).toContain('viewBox="0 0 100 100"');
    expect(faviconSvg).toContain('#0B1020');
    expect(faviconSvg).toContain('#2A3655');
    expect(faviconSvg).toContain('#F8FAFC');
    expect(faviconSvg).toContain('#FF5701');
    expect(faviconSvg).toContain('x="14"');
    expect(faviconSvg).toContain('y="10"');
    expect(faviconSvg).toContain('width="22"');
    expect(faviconSvg).toContain('height="80"');
    expect(faviconSvg).toContain('rx="6"');
    expect(faviconSvg).toContain('d="M46 10 H65 A23 23 0 0 1 65 56 H46 Z"');
    expect(faviconSvg).toContain('cx="68"');
    expect(faviconSvg).toContain('cy="79"');
    expect(faviconSvg).toContain('r="13"');

    const indexHtml = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(indexHtml).toMatch(/<link[^>]*rel="icon"[^>]*type="image\/svg\+xml"[^>]*href="\/favicon\.svg"/);
  });

  it('renders the geometric video mark in Landing header, footer, and auth modal without "P" text badges', () => {
    const { container } = render(
      <LandingPage
        navigate={vi.fn()}
        initialMode="login"
        authConfig={{ signupEnabled: true, googleEnabled: true }}
      />,
    );

    const header = container.querySelector('[data-od-id="nav-header"]') as HTMLElement;
    const headerBrand = header.querySelector('.pl-brand') as HTMLElement;
    expect(headerBrand).not.toBeNull();
    assertVideoMarkSvg(headerBrand);
    expect(headerBrand.textContent?.trim()).toBe('Planora');

    const footer = container.querySelector('[data-od-id="footer"]') as HTMLElement;
    const footerBrand = footer.querySelector('a[href="#workflow-showcase"]') as HTMLElement;
    expect(footerBrand).not.toBeNull();
    assertVideoMarkSvg(footerBrand);
    expect(footerBrand.textContent?.trim()).toBe('PLANORA');

    const modalCard = document.querySelector('[data-od-id="auth-modal-card"]') as HTMLElement;
    expect(modalCard).not.toBeNull();
    assertVideoMarkSvg(modalCard);
    expect(modalCard.querySelectorAll('svg[data-planora-mark="true"]')).toHaveLength(2);
    expect(modalCard.querySelector('.pl-brand-mark')).toBeNull();
  });

  it('renders the geometric video mark across MainNav, Guide, Privacy, AuthAction, and NotFound', () => {
    const member = { id: 'u1', name: 'Lan Nguyễn', email: 'lan@example.test', role: 'member' as const };
    const mainNav = render(<MainNav user={member} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
    const mainLogo = within(screen.getByRole('banner')).getByRole('link', { name: /Về không gian làm việc/ });
    assertVideoMarkSvg(mainLogo);
    expect(mainLogo.textContent?.trim()).toBe('Planora');
    mainNav.unmount();

    const guide = render(<GuidePage user={null} navigate={vi.fn()} />);
    const guideLogo = within(screen.getByRole('banner')).getByRole('link', { name: /Planora/ });
    assertVideoMarkSvg(guideLogo);
    expect(guideLogo.textContent?.trim()).toBe('Planora');
    guide.unmount();

    const privacy = render(<PrivacyPage user={null} navigate={vi.fn()} />);
    const privacyHeader = document.querySelector('[data-od-id="privacy-header"]') as HTMLElement;
    const privacyFooter = document.querySelector('[data-od-id="privacy-footer"]') as HTMLElement;
    assertVideoMarkSvg(privacyHeader);
    expect(within(privacyHeader).getByRole('link', { name: /Về trang chủ Planora/ }).textContent?.trim()).toBe('Planora');
    assertVideoMarkSvg(privacyFooter);
    expect(privacyFooter.textContent).not.toMatch(/^\s*P\s*Planora/);
    privacy.unmount();

    const authAction = render(<AuthActionPage mode="verify-success" navigate={vi.fn()} />);
    const authLogo = within(screen.getByRole('banner')).getByRole('link', { name: /Planora/ });
    assertVideoMarkSvg(authLogo);
    expect(authLogo.textContent?.trim()).toBe('Planora');
    authAction.unmount();

    const notFound = render(<NotFoundPage signedIn={false} navigate={vi.fn()} />);
    const notFoundLogo = within(screen.getByRole('banner')).getByRole('link', { name: /Planora/ });
    assertVideoMarkSvg(notFoundLogo);
    expect(notFoundLogo.textContent?.trim()).toBe('Planora');
    notFound.unmount();
  });
});
