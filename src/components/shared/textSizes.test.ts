import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every source file under src, for a scan of the class names it uses. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("text sizes", () => {
  it("are only the ones the theme defines, so none silently falls back to the body size", () => {
    // index.css resets every --text-* and defines its own; a Tailwind default such as
    // text-2xl then produces no CSS at all (that is how the page titles came out at 15 px).
    const css = readFileSync(join(__dirname, "../../index.css"), "utf8");
    const defined = new Set([...css.matchAll(/--text-([a-z0-9]+):/g)].map((m) => m[1]));
    const used = new Map<string, string>();
    for (const file of sources(join(__dirname, "../.."))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(
        /(?<![\w-])text-(xs|sm|base|lg|xl|\dxl|title|hero|md)(?![\w-])/g,
      )) {
        if (m[1] && !defined.has(m[1])) used.set(`text-${m[1]}`, file);
      }
    }
    expect([...used.entries()]).toEqual([]);
  });
});
