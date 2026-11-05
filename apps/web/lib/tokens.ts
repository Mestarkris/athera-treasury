import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Parse custom properties straight out of styles/tokens.css so the reference page cannot drift. */
export function readTokens() {
  const css = readFileSync(resolve(process.cwd(), "styles/tokens.css"), "utf8");
  const block = (selector: RegExp): Record<string, string> => {
    const m = selector.exec(css);
    if (!m) return {};
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i + 1;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) break;
    }
    const body = css.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, "");
    return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1] ?? "", (x[2] ?? "").trim()]));
  };
  return { light: block(/^:root\s*\{/m), dark: block(/^:root\[data-theme="dark"\]\s*\{/m) };
}

function lum(hex: string) {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
