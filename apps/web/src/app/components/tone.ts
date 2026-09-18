import type { Tone } from "../../core/presentation.js";

/** Soft background + strong text for each semantic tone (DESIGN.md colors). */
export const TONE_CLASSES: Record<Tone, string> = {
  progress: "bg-progress-subtle text-progress",
  action: "bg-action-subtle text-action",
  success: "bg-success-subtle text-success",
  danger: "bg-danger-subtle text-danger",
  unknown: "bg-unknown-subtle text-unknown",
  neutral: "bg-neutral-subtle text-neutral",
  planner: "bg-planner-subtle text-planner",
};

export const TONE_TEXT: Record<Tone, string> = {
  progress: "text-progress",
  action: "text-action",
  success: "text-success",
  danger: "text-danger",
  unknown: "text-unknown",
  neutral: "text-neutral",
  planner: "text-planner",
};
