import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the custom type scale so `text-body-sm` and
// `text-muted` are not treated as the same conflicting group.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-md",
            "display-md-mobile",
            "headline-sm",
            "headline-sm-mobile",
            "title-md",
            "body-lg",
            "body-md",
            "body-sm",
            "button-md",
            "button-sm",
            "nav-link",
            "badge",
            "caption",
            "overline",
            "wordmark",
            "mono-md",
            "mono-sm",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
