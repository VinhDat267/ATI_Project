import {
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type MouseEvent,
  type KeyboardEvent,
} from "react";

/** Adds interaction to the existing hero markup without rendering on pointermove. */
export function useHeroMotion() {
  const rotator = useRef<HTMLDivElement>(null);
  const float = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const motion = useRef({
    x: 0,
    y: 0,
    reduced: false,
    backVisible: false,
    frame: 0,
    inertia: 0,
    resume: 0,
    clickTimer: 0,
    suppressClick: false,
    pointer: null as null | {
      id: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      time: number;
      velocity: number;
      dragging: boolean;
      scrolling: boolean;
    },
  });
  const paint = () => {
    const m = motion.current;
    if (!rotator.current) return;
    rotator.current.style.transform = `rotateX(${m.x}deg) rotateY(${m.y}deg)`;
    // Hide only the reverse-facing surface, including its keyboard controls.
    const angle = ((m.y % 360) + 360) % 360;
    const isBack = angle > 90 && angle < 270;
    if (isBack !== m.backVisible) {
      m.backVisible = isBack;
      for (const [face, hidden] of [
        [front.current, isBack],
        [back.current, !isBack],
      ] as const) {
        if (face) {
          face.inert = hidden;
          face.setAttribute("aria-hidden", String(hidden));
        }
      }
    }
  };
  const queuePaint = () => {
    const m = motion.current;
    if (!m.frame)
      m.frame = requestAnimationFrame(() => {
        m.frame = 0;
        paint();
      });
  };
  const cancelInertia = () => {
    const m = motion.current;
    cancelAnimationFrame(m.inertia);
    m.inertia = 0;
  };
  const resumeFloat = () => {
    const m = motion.current;
    clearTimeout(m.resume);
    m.resume = window.setTimeout(() => {
      m.resume = 0;
      if (float.current) float.current.style.animationPlayState = "running";
    }, 400);
  };
  const coast = (velocity: number) => {
    const m = motion.current;
    if (m.reduced || Math.abs(velocity) < 0.003) return;
    let previous = performance.now();
    const started = previous;
    const tick = (now: number) => {
      if (now - started >= 240) {
        m.inertia = 0;
        return;
      }
      const dt = Math.min(Math.max(now - previous, 0), 32);
      previous = now;
      velocity *= Math.exp(-dt / 85);
      m.y += velocity * dt;
      paint();
      m.inertia = Math.abs(velocity) >= 0.003 ? requestAnimationFrame(tick) : 0;
    };
    m.inertia = requestAnimationFrame(tick);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const m = motion.current;
    if (!e.isPrimary || e.button !== 0 || m.pointer) return;
    cancelInertia();
    clearTimeout(m.resume);
    clearTimeout(m.clickTimer);
    m.suppressClick = false;
    m.pointer = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      time: performance.now(),
      velocity: 0,
      dragging: false,
      scrolling: false,
    };
    // No preventDefault/capture here: a normal press must still click its child.
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const m = motion.current,
      p = m.pointer;
    if (!p || p.id !== e.pointerId || p.scrolling) return;
    if (!p.dragging) {
      const dx = e.clientX - p.startX,
        dy = e.clientY - p.startY;
      if (Math.hypot(dx, dy) < 5) return;
      if (e.pointerType === "touch" && Math.abs(dy) > Math.abs(dx)) {
        p.scrolling = true;
        return;
      }
      p.dragging = true;
      m.suppressClick = true;
      rotator.current?.setAttribute("data-dragging", "true");
      if (float.current) float.current.style.animationPlayState = "paused";
      document.getSelection()?.removeAllRanges();
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    const now = performance.now(),
      dx = e.clientX - p.lastX;
    m.y += dx * 0.35; // Intentionally unbounded: repeated full turns are retained.
    m.x = Math.max(-12, Math.min(12, m.x - (e.clientY - p.lastY) * 0.15));
    p.velocity = Math.max(
      -0.08,
      Math.min(0.08, (dx * 0.35) / Math.max(now - p.time, 8)),
    );
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    p.time = now;
    queuePaint();
  };
  const finish = (e: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const m = motion.current,
      p = m.pointer;
    if (!p || p.id !== e.pointerId) return;
    m.pointer = null;
    rotator.current?.removeAttribute("data-dragging");
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (p.dragging) {
      cancelAnimationFrame(m.frame);
      m.frame = 0;
      paint();
      if (!cancelled && performance.now() - p.time < 80) coast(p.velocity);
      // The browser's post-drag click fires before this timeout; a new press clears it.
      m.clickTimer = window.setTimeout(() => {
        m.suppressClick = false;
        m.clickTimer = 0;
      }, 350);
    }
    if (float.current?.style.animationPlayState === "paused") resumeFloat();
  };
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (motion.current.suppressClick && e.detail !== 0) {
      e.preventDefault();
      e.stopPropagation();
      motion.current.suppressClick = false;
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      e.target !== e.currentTarget ||
      !["ArrowLeft", "ArrowRight"].includes(e.key)
    )
      return;
    e.preventDefault();
    cancelInertia();
    motion.current.y += e.key === "ArrowRight" ? 15 : -15;
    queuePaint();
  };
  useLayoutEffect(() => {
    // Set the presentation pose before first paint, then let input own the angles.
    const compact = window.matchMedia?.("(max-width: 760px)").matches;
    motion.current.x = compact ? 0 : 6;
    motion.current.y = compact ? 0 : -12;
    paint();
  }, []);
  useEffect(() => {
    const m = motion.current;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    m.reduced = Boolean(media?.matches);
    const change = (e: MediaQueryListEvent) => {
      m.reduced = e.matches;
      if (e.matches) cancelInertia();
    };
    media?.addEventListener("change", change);
    return () => {
      media?.removeEventListener("change", change);
      cancelAnimationFrame(m.frame);
      cancelInertia();
      clearTimeout(m.resume);
      clearTimeout(m.clickTimer);
      m.pointer = null;
      m.frame = 0;
    };
  }, []);
  return {
    rotator,
    float,
    front,
    back,
    events: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: PointerEvent<HTMLDivElement>) => finish(e),
      onPointerCancel: (e: PointerEvent<HTMLDivElement>) => finish(e, true),
      onLostPointerCapture: (e: PointerEvent<HTMLDivElement>) =>
        finish(e, true),
      onPointerLeave: (e: PointerEvent<HTMLDivElement>) => {
        if (!motion.current.pointer?.dragging) finish(e, true);
      },
      onClickCapture,
      onKeyDown,
      onDragStart: (e: MouseEvent<HTMLDivElement>) => e.preventDefault(),
    },
  };
}
