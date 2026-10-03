/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LandingPageView } from "../../src/components/LandingPageView";

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
  }
}

describe("Existing Planora hero physical card", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let reduced: boolean;
  let compact: boolean;
  let mediaListeners: Set<(e: { matches: boolean }) => void>;
  const advanceFrame = (time: number) => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((cb) => cb(time));
  };
  const setup = () => {
    const result = render(<LandingPageView onGoToLogin={vi.fn()} />);
    const rotator =
      result.container.querySelector<HTMLElement>(".hero-rotator")!;
    const float = result.container.querySelector<HTMLElement>(".hero-float")!;
    const front = result.container.querySelector<HTMLElement>(".hero-front")!;
    const back = result.container.querySelector<HTMLElement>(".hero-back")!;
    return { ...result, rotator, float, front, back };
  };
  const pointer = (
    node: HTMLElement,
    type: string,
    x: number,
    y = 0,
    pointerType = "mouse",
  ) => {
    fireEvent(
      node,
      new TestPointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerType,
      }),
    );
  };
  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    nextFrame = 0;
    reduced = false;
    compact = true;
    mediaListeners = new Set();
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        frames.set(++nextFrame, cb);
        return nextFrame;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => frames.delete(id)),
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        get matches() { return query.includes("max-width") ? compact : query.includes("prefers-reduced-motion") ? reduced : false; },
        addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
          if (query.includes("prefers-reduced-motion")) mediaListeners.add(fn);
        },
        removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => mediaListeners.delete(fn),
      })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts in the desktop presentation pose and continues dragging without resetting on rerender", () => {
    compact = false;
    reduced = true;
    const { rotator, float, rerender, unmount } = setup();
    expect(rotator.style.transform).toBe("rotateX(6deg) rotateY(-12deg)");
    pointer(rotator, "pointerdown", 0);
    pointer(rotator, "pointermove", 100);
    advanceFrame(16);
    expect(rotator.style.transform).toBe("rotateX(6deg) rotateY(23deg)");
    pointer(rotator, "pointerup", 100);
    vi.advanceTimersByTime(400);
    rerender(<LandingPageView onGoToLogin={vi.fn()} />);
    expect(rotator.style.transform).toBe("rotateX(6deg) rotateY(23deg)");
    expect(float.style.animationPlayState).toBe("running");
    unmount();
    expect(setup().rotator.style.transform).toBe("rotateX(6deg) rotateY(-12deg)");
  });

  it("starts straight on compact screens for readable content", () => {
    expect(setup().rotator.style.transform).toBe("rotateX(0deg) rotateY(0deg)");
  });

  it("keeps the front markup and a normal child click below the drag threshold", () => {
    const { rotator, float, front } = setup();
    expect(front).toHaveTextContent("Tạo issue trên GitHub");
    expect(front).toHaveTextContent("Duyệt và thực thi");
    // A real child control verifies propagation without turning the demo into a write CTA.
    const button = document.createElement("button"),
      clicked = vi.fn();
    front.append(button);
    button.addEventListener("click", clicked);
    pointer(button, "pointerdown", 10);
    pointer(rotator, "pointermove", 13);
    pointer(button, "pointerup", 13);
    fireEvent.click(button, { detail: 1 });
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(float.style.animationPlayState).not.toBe("paused");
    expect(rotator.style.transform).not.toContain("1.05deg");
  });

  it("rotates past 720 degrees, clamps X, pauses floating and suppresses the drag click", () => {
    const { rotator, float, front } = setup();
    const button = document.createElement("button"),
      clicked = vi.fn();
    front.append(button);
    button.addEventListener("click", clicked);
    pointer(button, "pointerdown", 0);
    pointer(rotator, "pointermove", 2400, 200);
    expect(float.style.animationPlayState).toBe("paused");
    expect(rotator.style.transform).not.toContain("840deg");
    advanceFrame(16);
    expect(rotator.style.transform).toContain("rotateY(840deg)");
    expect(rotator.style.transform).toContain("rotateX(-12deg)");
    pointer(rotator, "pointerup", 2400, 200);
    fireEvent.click(button, { detail: 1 });
    expect(clicked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(float.style.animationPlayState).toBe("running");
    expect(rotator.style.transform).toContain("840deg");
  });

  it("presents the back around 180 degrees and the front after another turn", () => {
    const { rotator, front, back } = setup();
    pointer(rotator, "pointerdown", 0);
    pointer(rotator, "pointermove", 514.285714);
    advanceFrame(16);
    expect(front).toHaveAttribute("aria-hidden", "true");
    expect(back).toHaveAttribute("aria-hidden", "false");
    expect(back).toHaveTextContent("Ý tưởng → Kế hoạch → Hành động");
    pointer(rotator, "pointermove", 1028.571428);
    advanceFrame(32);
    expect(front).toHaveAttribute("aria-hidden", "false");
    expect(back).toHaveAttribute("aria-hidden", "true");
  });

  it("leaves vertical touch gestures to page scrolling but accepts horizontal touch drag", () => {
    const { rotator, float } = setup();
    pointer(rotator, "pointerdown", 0, 0, "touch");
    pointer(rotator, "pointermove", 2, 30, "touch");
    advanceFrame(16);
    expect(float.style.animationPlayState).not.toBe("paused");
    pointer(rotator, "pointercancel", 2, 30, "touch");
    pointer(rotator, "pointerdown", 0, 0, "touch");
    pointer(rotator, "pointermove", 100, 2, "touch");
    advanceFrame(32);
    expect(rotator.style.transform).toContain("rotateY(35deg)");
    expect(float.style.animationPlayState).toBe("paused");
  });

  it("retains manual rotation with reduced motion and cancels work on unmount", () => {
    reduced = true;
    const { rotator, unmount } = setup();
    pointer(rotator, "pointerdown", 0);
    pointer(rotator, "pointermove", -200, -200);
    advanceFrame(16);
    pointer(rotator, "pointerup", -200, -200);
    expect(rotator.style.transform).toContain("rotateY(-70deg)");
    expect(rotator.style.transform).toContain("rotateX(12deg)");
    expect(frames.size).toBe(0);
    pointer(rotator, "pointerdown", -200);
    pointer(rotator, "pointermove", -210);
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels bounded inertia when grabbed again or reduced motion is enabled", () => {
    const { rotator } = setup();
    pointer(rotator, "pointerdown", 0);
    vi.advanceTimersByTime(16);
    pointer(rotator, "pointermove", 100);
    advanceFrame(performance.now());
    pointer(rotator, "pointerup", 100);
    expect(frames.size).toBe(1);
    pointer(rotator, "pointerdown", 100);
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(16);
    pointer(rotator, "pointermove", 200);
    advanceFrame(performance.now());
    pointer(rotator, "pointerup", 200);
    expect(frames.size).toBe(1);
    reduced = true;
    mediaListeners.forEach((listener) => listener({ matches: true }));
    expect(frames.size).toBe(0);
  });

  it("limits coast to a brief few degrees and keeps rotation when float resumes", () => {
    const { rotator, float } = setup();
    pointer(rotator, "pointerdown", 0);
    vi.advanceTimersByTime(16);
    pointer(rotator, "pointermove", 100);
    advanceFrame(performance.now());
    pointer(rotator, "pointerup", 100);
    for (let i = 0; i < 16; i++) {
      vi.advanceTimersByTime(16);
      advanceFrame(performance.now());
    }
    const angle = Number(
      rotator.style.transform.match(/rotateY\(([^d]+)deg\)/)![1],
    );
    expect(angle).toBeGreaterThan(35);
    expect(angle).toBeLessThan(43);
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(400);
    expect(float.style.animationPlayState).toBe("running");
    expect(rotator.style.transform).toContain(`rotateY(${angle}deg)`);
  });

  it("does not get stuck after leaving before the threshold; pen cancel resumes without inertia", () => {
    const { rotator, float } = setup();
    pointer(rotator, "pointerdown", 500);
    fireEvent.pointerOut(rotator, {
      pointerId: 1,
      relatedTarget: document.body,
    });
    pointer(rotator, "pointerdown", 0, 0, "pen");
    pointer(rotator, "pointermove", 100, 0, "pen");
    advanceFrame(16);
    expect(rotator.style.transform).toContain("rotateY(35deg)");
    pointer(rotator, "pointercancel", 100, 0, "pen");
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(400);
    expect(float.style.animationPlayState).toBe("running");
  });

  it("ends inertia by elapsed time even if animation frames are delayed", () => {
    const { rotator } = setup();
    pointer(rotator, "pointerdown", 0);
    vi.advanceTimersByTime(16);
    pointer(rotator, "pointermove", 100);
    advanceFrame(performance.now());
    pointer(rotator, "pointerup", 100);
    vi.advanceTimersByTime(300);
    advanceFrame(performance.now());
    expect(frames.size).toBe(0);
  });
});
