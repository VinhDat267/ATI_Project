/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { LandingPageView } from "../../src/components/LandingPageView";

describe("Landing scroll story lifecycle", () => {
  let frames: Map<number, FrameRequestCallback>, id: number, reduced: boolean;
  let listeners: Set<(event: { matches: boolean }) => void>;
  let observers: Array<{ callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn> }>;
  const flush = () => act(() => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach((callback) => callback(100));
  });
  beforeEach(() => {
    frames = new Map(); id = 0; reduced = false; listeners = new Set(); observers = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frame: number) => frames.delete(frame)));
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() { return query.includes("prefers-reduced-motion") && reduced; },
      addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => { if (query.includes("prefers-reduced-motion")) listeners.add(fn); },
      removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.delete(fn),
    }));
    vi.stubGlobal("IntersectionObserver", class {
      disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn();
      constructor(callback: IntersectionObserverCallback) { observers.push({ callback, disconnect: this.disconnect, observe: this.observe, unobserve: this.unobserve }); }
    });
    vi.stubGlobal("innerWidth", 1440); vi.stubGlobal("innerHeight", 900);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("reveals each workflow card only as it enters view, then stops observing it", () => {
    const { container } = render(<LandingPageView onGoToLogin={vi.fn()} />);
    const cards = [...container.querySelectorAll<HTMLElement>(".how-card")];
    const reveal = observers[0];
    cards.forEach((card) => expect(reveal.observe).toHaveBeenCalledWith(card));
    const entry = (target: HTMLElement, isIntersecting: boolean): IntersectionObserverEntry => ({
      target, isIntersecting, intersectionRatio: isIntersecting ? 0.2 : 0, time: 100,
      boundingClientRect: target.getBoundingClientRect(), intersectionRect: target.getBoundingClientRect(), rootBounds: null,
    });
    act(() => reveal.callback([entry(cards[0], false)], {} as IntersectionObserver));
    expect(cards.every((card) => !card.dataset.revealed)).toBe(true);
    act(() => reveal.callback([entry(cards[0], true)], {} as IntersectionObserver));
    expect(cards[0].dataset.revealed).toBe("true");
    expect(cards[1].dataset.revealed).toBeUndefined();
    expect(cards[2].dataset.revealed).toBeUndefined();
    expect(reveal.unobserve).toHaveBeenCalledWith(cards[0]);
    expect(cards[0]).not.toHaveAttribute("aria-hidden");
    reduced = true; act(() => listeners.forEach((fn) => fn({ matches: true })));
    expect(container.querySelector("[data-landing-motion]")).toBeNull();
    expect(container.querySelectorAll(".how-card")).toHaveLength(3);
    expect(container).toHaveTextContent("Theo dõi đến kết quả.");
  });

  it("follows real section geometry forwards and backwards without rendering on every scroll", () => {
    const { container } = render(<LandingPageView onGoToLogin={vi.fn()} />);
    const grid = container.querySelector<HTMLElement>(".how-grid")!;
    const cards = [...grid.querySelectorAll<HTMLElement>(".how-card")];
    let top = 738;
    vi.spyOn(grid, "getBoundingClientRect").mockImplementation(() => ({ top, height: 260 }) as DOMRect);
    act(() => observers[1].callback([{
      target: grid, isIntersecting: true, intersectionRatio: 1, time: 100,
      boundingClientRect: grid.getBoundingClientRect(), intersectionRect: grid.getBoundingClientRect(), rootBounds: null,
    }], {} as IntersectionObserver));
    flush();
    expect(cards.map((card) => card.dataset.stage)).toEqual(["active", "waiting", "waiting"]);
    top = 400;
    fireEvent.scroll(window); fireEvent.scroll(window);
    expect(frames.size).toBe(1);
    flush();
    expect(cards.map((card) => card.dataset.stage)).toEqual(["passed", "active", "waiting"]);
    top = 150; fireEvent.scroll(window); flush();
    expect(cards[2].dataset.stage).toBe("active");
    top = 700; fireEvent.scroll(window); flush();
    expect(cards[0].dataset.stage).toBe("active");
  });

  it("stops travel on reduced-motion changes and cancels queued frames and observers on unmount", () => {
    const { container, unmount } = render(<LandingPageView onGoToLogin={vi.fn()} />);
    expect(frames.size).toBeGreaterThan(0);
    reduced = true; act(() => listeners.forEach((fn) => fn({ matches: true })));
    expect(frames.size).toBe(0);
    expect(container.querySelector("[data-landing-motion]")).toBeNull();
    expect(container.querySelectorAll("[data-stage]")).toHaveLength(0);
    reduced = false; act(() => listeners.forEach((fn) => fn({ matches: false })));
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
    expect(listeners.size).toBe(0);
    fireEvent.scroll(window);
    expect(frames.size).toBe(0);
  });

  it("reaches the final stage on a short page before scrolling runs out", () => {
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(1800);
    vi.stubGlobal("scrollY", 900);
    const { container } = render(<LandingPageView onGoToLogin={vi.fn()} />);
    const grid = container.querySelector<HTMLElement>(".how-grid")!;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({ top: 300 } as DOMRect);
    flush();
    expect(grid.style.getPropertyValue("--story-progress")).toBe("1");
    expect(grid.querySelectorAll<HTMLElement>(".how-card")[2].dataset.stage).toBe("active");
  });

  it("uses the distance between the first and last mobile step for vertical travel", () => {
    vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", 844);
    const { container } = render(<LandingPageView onGoToLogin={vi.fn()} />);
    const grid = container.querySelector<HTMLElement>(".how-grid")!;
    const cards = grid.querySelectorAll<HTMLElement>(".how-card");
    vi.spyOn(cards[0], "offsetTop", "get").mockReturnValue(0);
    vi.spyOn(cards[2], "offsetTop", "get").mockReturnValue(600);
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({ top: 844 * 0.65 - 300 } as DOMRect);
    flush();
    expect(grid.style.getPropertyValue("--story-length")).toBe("600px");
    expect(cards[1].dataset.stage).toBe("active");
  });
});
