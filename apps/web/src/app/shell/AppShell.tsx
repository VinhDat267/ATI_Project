import { useQuery } from "@tanstack/react-query";
import { Dialog, DropdownMenu } from "radix-ui";
import { useState, type ReactNode } from "react";
import { attentionCount } from "../../core/presentation.js";
import { listQuery } from "../../core/queries.js";
import type { Route } from "../../core/navigation.js";
import { navigate, routeToHash } from "../../core/navigation.js";
import { cn } from "@/lib/cn";
import { useApp } from "../context";
import { Icon } from "../components/Icon";
import { Logo } from "./Logo";

const NAV: Array<{ route: Route; label: string }> = [
  { route: { page: "overview" }, label: "Tổng quan" },
  { route: { page: "new" }, label: "Tạo yêu cầu" },
  { route: { page: "history" }, label: "Lần chạy" },
  { route: { page: "tools" }, label: "Công cụ & kết nối" },
];

function isActive(route: Route, item: Route): boolean {
  return (
    route.page === item.page ||
    (route.page === "run" && item.page === "history")
  );
}

function AttentionBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-action-subtle px-1.5 text-overline tracking-normal text-action">
      <span className="sr-only">cần xử lý: </span>
      {count}
    </span>
  );
}

function DemoBadge() {
  return (
    <span className="inline-flex h-6.5 items-center whitespace-nowrap rounded-full bg-demo-subtle px-2.5 text-badge text-demo">
      Dữ liệu mô phỏng
    </span>
  );
}

export function AppShell({
  route,
  children,
}: {
  route: Route;
  children: ReactNode;
}) {
  const { transport, generation, session, email, mode } = useApp();
  const list = useQuery(listQuery(transport, generation));
  const attention = list.data ? attentionCount(list.data) : 0;
  const [menuOpen, setMenuOpen] = useState(false);

  const signOut = (): void => {
    setMenuOpen(false);
    session.clear();
    navigate({ page: "login" }, true);
  };

  const navLinks = (variant: "bar" | "sheet") =>
    NAV.map(({ route: item, label }) => {
      const active = isActive(route, item);
      return (
        <a
          key={item.page}
          href={routeToHash(item)}
          aria-current={active ? "page" : undefined}
          onClick={() => setMenuOpen(false)}
          className={cn(
            "flex items-center no-underline",
            variant === "bar"
              ? cn(
                  "h-20 border-b-2 text-nav-link",
                  active
                    ? "border-ink font-semibold text-ink"
                    : "border-transparent text-muted hover:text-ink",
                )
              : cn(
                  "min-h-12 rounded-sm px-3 text-title-md",
                  active ? "bg-surface-strong text-ink" : "text-ink",
                ),
          )}
        >
          {label}
          {item.page === "history" ? <AttentionBadge count={attention} /> : null}
        </a>
      );
    });

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-sm focus:bg-canvas focus:p-3"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Bỏ qua đến nội dung chính
      </a>
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between gap-4 px-6 desk:grid-header desk:h-20 xl:px-0">
          <a
            href={routeToHash({ page: "overview" })}
            className="flex min-h-11 items-center no-underline"
            aria-label="ATI — Tổng quan"
          >
            <Logo />
          </a>

          <nav
            aria-label="Điều hướng chính"
            className="hidden justify-self-center desk:flex desk:gap-8"
          >
            {navLinks("bar")}
          </nav>

          <div className="flex items-center gap-3 justify-self-end">
            {mode === "fixture" ? <DemoBadge /> : null}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label={`Tài khoản ${email ?? ""}`.trim()}
                  className="hidden h-10 items-center gap-2 rounded-full border border-hairline bg-canvas pl-3 pr-1.5 shadow-card desk:flex"
                >
                  <Icon name="menu" />
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary text-overline tracking-normal text-on-primary">
                    {(email ?? "?").charAt(0).toUpperCase()}
                  </span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="z-20 min-w-56 rounded-md border border-hairline bg-canvas p-2 shadow-card"
                >
                  <DropdownMenu.Label className="px-3 py-2 text-body-sm text-muted">
                    {email ?? "Phiên hiện tại"}
                  </DropdownMenu.Label>
                  <DropdownMenu.Item
                    onSelect={signOut}
                    className="flex min-h-11 cursor-pointer items-center rounded-sm px-3 text-body-md outline-none data-[highlighted]:bg-surface-soft"
                  >
                    Đăng xuất
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  aria-label="Mở menu"
                  className="relative flex size-11 items-center justify-center rounded-full border border-hairline desk:hidden"
                >
                  <Icon name="menu" size={20} />
                  {attention > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-action-subtle px-1 text-overline tracking-normal text-action">
                      <span className="sr-only">cần xử lý: </span>
                      {attention}
                    </span>
                  ) : null}
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-20 bg-ink/40" />
                <Dialog.Content className="fixed inset-y-0 right-0 z-30 flex w-80 max-w-full flex-col gap-2 bg-canvas p-6 shadow-card">
                  <div className="flex items-center justify-between">
                    <Dialog.Title className="m-0 text-title-md">Menu</Dialog.Title>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        aria-label="Đóng menu"
                        className="flex size-11 items-center justify-center rounded-full"
                      >
                        <Icon name="x" size={20} />
                      </button>
                    </Dialog.Close>
                  </div>
                  <Dialog.Description className="sr-only">
                    Điều hướng chính và tài khoản
                  </Dialog.Description>
                  <nav aria-label="Điều hướng chính" className="flex flex-col gap-1">
                    {navLinks("sheet")}
                  </nav>
                  <div className="mt-auto flex flex-col gap-2 border-t border-hairline pt-4">
                    <span className="text-body-sm text-muted">{email}</span>
                    <button
                      type="button"
                      onClick={signOut}
                      className="flex min-h-11 items-center text-button-md underline underline-offset-3"
                    >
                      Đăng xuất
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-content flex-col gap-6 px-6 pb-16 pt-7 outline-none xl:px-0"
      >
        {children}
      </main>
    </div>
  );
}
