import { useEffect, useRef, type PointerEvent } from "react";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Scroll is sampled once per frame; only discrete stage changes touch attributes. */
export function useLandingStory() {
  const root = useRef<HTMLDivElement>(null);
  const story = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const magnet = useRef<HTMLButtonElement>(null);
  const input = useRef({ enabled: false, frame: 0, x: 0, y: 0, light: 0 });

  useEffect(() => {
    const page = root.current, grid = story.current, heading = title.current;
    if (!page || !grid || !heading) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)");
    let frame = 0, near = false, disposed = false;
    let reveal: IntersectionObserver | undefined;
    let visibility: IntersectionObserver | undefined;
    const visible = new Set<Element>();
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(".how-card"));
    const paint = () => {
      frame = 0;
      if (disposed || reduced?.matches) return;
      const box = grid.getBoundingClientRect();
      const compact = window.innerWidth <= 760;
      // A short page must still reach stage 03 before the footer. Opening roadmap
      // shouldn't change the workflow's scroll range or rewind the completed story.
      const disclosure = page.querySelector<HTMLElement>(".roadmap-unfold");
      const expandedHeight = disclosure && !disclosure.hidden
        ? disclosure.offsetHeight + parseFloat(getComputedStyle(disclosure).marginTop || "0") : 0;
      const available = document.documentElement.scrollHeight - window.innerHeight - expandedHeight
        - (window.scrollY + box.top - window.innerHeight * 0.82);
      const distance = compact
        ? Math.max(1, cards[2].offsetTop - cards[0].offsetTop)
        : Math.max(1, Math.min(window.innerHeight * 0.64, available));
      if (compact) grid.style.setProperty("--story-length", `${distance}px`);
      const progress = clamp((window.innerHeight * (compact ? 0.65 : 0.82) - box.top) / distance);
      grid.style.setProperty("--story-progress", String(progress));
      grid.style.setProperty("--token-position", `${progress * 100}%`);
      const stage = progress < 0.5 ? 0 : progress < 0.98 ? 1 : 2;
      cards.forEach((card, index) => {
        const status = index === stage ? "active" : index < stage ? "passed" : "waiting";
        if (card.dataset.stage !== status) card.dataset.stage = status;
      });
      // Small depth offset only on desktop; text masks have their own inner transform.
      const depth = compact ? 0 : (1 - clamp((window.innerHeight - heading.getBoundingClientRect().top) / window.innerHeight)) * 10;
      heading.style.setProperty("--heading-depth", `${depth.toFixed(2)}px`);
    };
    const queue = () => {
      if (!disposed && !reduced?.matches && !frame) frame = requestAnimationFrame(paint);
    };
    const scroll = () => { if (near) queue(); };
    const resetPointer = () => {
      input.current.enabled = Boolean(fine?.matches && !reduced?.matches && window.innerWidth > 760);
      cancelAnimationFrame(input.current.frame);
      input.current.frame = 0;
      panel.current?.style.removeProperty("--paper-shift");
      magnet.current?.style.removeProperty("--magnet-x");
      magnet.current?.style.removeProperty("--magnet-y");
    };
    const configure = () => {
      reveal?.disconnect();
      visibility?.disconnect();
      visible.clear();
      cancelAnimationFrame(frame);
      frame = 0;
      resetPointer();
      if (reduced?.matches || typeof IntersectionObserver === "undefined") {
        delete page.dataset.landingMotion;
        grid.style.removeProperty("--story-progress");
        grid.style.removeProperty("--token-position");
        grid.style.removeProperty("--story-length");
        heading.style.removeProperty("--heading-depth");
        cards.forEach((card) => delete card.dataset.stage);
        return;
      }
      page.dataset.landingMotion = "ready";
      reveal = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.revealed = "true";
            reveal?.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });
      page.querySelectorAll("[data-landing-reveal]").forEach((element) => reveal!.observe(element));
      visibility = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        });
        near = visible.size > 0;
        if (near) queue();
      }, { rootMargin: "100px" });
      visibility.observe(heading);
      visibility.observe(grid);
      queue(); // Direct #how navigation and resize need no first scroll event.
    };
    const resize = () => { resetPointer(); queue(); };
    configure();
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize);
    reduced?.addEventListener("change", configure);
    fine?.addEventListener("change", resetPointer);
    return () => {
      disposed = true;
      reveal?.disconnect();
      visibility?.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(input.current.frame);
      input.current.frame = 0;
      input.current.enabled = false;
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", resize);
      reduced?.removeEventListener("change", configure);
      fine?.removeEventListener("change", resetPointer);
    };
  }, []);

  const queuePointer = () => {
    const current = input.current;
    if (current.frame) return;
    current.frame = requestAnimationFrame(() => {
      current.frame = 0;
      panel.current?.style.setProperty("--paper-shift", `${current.light}px`);
      magnet.current?.style.setProperty("--magnet-x", `${current.x}px`);
      magnet.current?.style.setProperty("--magnet-y", `${current.y}px`);
    });
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = input.current;
    if (!current.enabled || event.pointerType === "touch" || !magnet.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    const button = magnet.current.getBoundingClientRect();
    const dx = event.clientX - (button.left + button.width / 2);
    const dy = event.clientY - (button.top + button.height / 2);
    const close = Math.abs(dx) < button.width / 2 + 48 && Math.abs(dy) < button.height / 2 + 48;
    current.x = close ? Math.max(-3, Math.min(3, dx * 0.035)) : 0;
    current.y = close ? Math.max(-3, Math.min(3, dy * 0.035)) : 0;
    current.light = (clamp((event.clientX - box.left) / box.width) - 0.5) * 16;
    queuePointer();
  };
  const onPointerLeave = () => {
    const current = input.current;
    if (!current.enabled) return;
    current.x = current.y = current.light = 0;
    queuePointer();
  };
  return { root, story, title, panel, magnet, pointer: { onPointerMove, onPointerLeave } };
}
