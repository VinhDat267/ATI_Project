import type { ReactNode } from "react";
import type { Tone } from "../../core/presentation.js";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./Icon";
import { TONE_CLASSES } from "./tone";

/**
 * Banner per DESIGN.md: 14px radius, 20px padding, icon in a 40px white
 * circle, 16/600 title and 15/24 body. `live` adds role=status for banners
 * that appear in response to something; static page banners stay silent.
 */
export function Banner({
  tone,
  icon,
  title,
  children,
  live = false,
  id,
  className,
  headingLevel,
}: {
  tone: Tone | "soft";
  icon: IconName;
  title: ReactNode;
  children?: ReactNode;
  live?: boolean;
  id?: string;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel ? (`h${headingLevel}` as const) : "p";
  return (
    <section
      id={id}
      role={live ? "status" : undefined}
      className={cn(
        "flex items-start gap-4 rounded-md p-5",
        tone === "soft" ? "bg-surface-soft text-ink" : TONE_CLASSES[tone],
        className,
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white">
        <Icon name={icon} size={20} />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Heading className="m-0 text-title-md">{title}</Heading>
        {children ? (
          <div className="max-w-measure text-body-md leading-6">{children}</div>
        ) : null}
      </div>
    </section>
  );
}
