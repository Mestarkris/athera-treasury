import type { SVGProps } from "react";

export type Mark = "check" | "cross" | "clock" | "square" | "dash";

/**
 * The four status marks, drawn rather than typed: these glyphs are not in Archivo or Plex Mono,
 * and font fallback would render them differently on every platform. Inherit currentColor.
 */
export function StatusMark({ mark, size = 12, ...rest }: { mark: Mark; size?: number } & SVGProps<SVGSVGElement>) {
  const common = { width: size, height: size, viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true, focusable: false, ...rest } as const;
  switch (mark) {
    case "check":
      return (
        <svg {...common}>
          <path d="M2 6.5 4.75 9.25 10 3" strokeLinecap="square" />
        </svg>
      );
    case "cross":
      return (
        <svg {...common}>
          <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="square" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.25" />
          <path d="M6 3.5V6h2" strokeLinecap="square" />
        </svg>
      );
    case "square":
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <rect x="2.5" y="2.5" width="7" height="7" />
        </svg>
      );
    case "dash":
      return (
        <svg {...common}>
          <path d="M3 6h6" />
        </svg>
      );
  }
}
