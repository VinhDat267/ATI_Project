import { cva, type VariantProps } from "class-variance-authority";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Buttons per DESIGN.md: 48px controls, 8px radius, navy primary. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm text-button-md no-underline transition-colors disabled:cursor-not-allowed aria-disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-on-primary hover:bg-primary-hover hover:text-on-primary disabled:bg-surface-strong disabled:text-muted",
        secondary:
          "border border-ink bg-canvas text-ink hover:bg-surface-soft hover:text-ink disabled:border-hairline disabled:text-muted",
        danger:
          "bg-danger text-on-primary hover:bg-danger-hover hover:text-on-primary",
        link: "bg-transparent px-1 text-ink underline underline-offset-3 hover:text-primary",
      },
      size: {
        md: "h-12 px-5",
        sm: "h-11 px-4 text-button-sm",
        compact: "h-9 px-3 text-button-sm",
        inline: "min-h-11 px-1",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

type Variants = VariantProps<typeof buttonVariants>;

export function Button({
  variant,
  size,
  block,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & Variants) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}

/** Navigation styled as a button: still a link (DESIGN.md: nav = link). */
export function ButtonLink({
  variant,
  size,
  block,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & Variants) {
  return (
    <a
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}
