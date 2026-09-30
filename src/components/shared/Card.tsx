import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * The one surface of the site: paper on a hairline border. Padding and layout go in
 * `className`; the look (radius, border, background, shadow) comes only from here.
 *
 * - `inset`: the smaller 8 px radius of a card inside a panel or another card.
 * - `elevation`: "flat" in the page, "raised" a little above it, "float" over the map, the
 *   3D view or other content.
 * - `tone`: "select" tints it as the current or proposed choice.
 */
export function Card({
  as: Tag = "div",
  inset = false,
  elevation = "flat",
  tone = "default",
  className,
  children,
  ...rest
}: {
  /** The element, when the surface is also a landmark: a section, a nav, an aside. */
  as?: "div" | "section" | "nav" | "aside" | "article";
  inset?: boolean;
  elevation?: "flat" | "raised" | "float";
  tone?: "default" | "select";
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cx(
        "border",
        inset ? "rounded-inner" : "rounded-card",
        tone === "select" ? "border-select bg-select-soft/40" : "border-line bg-paper",
        elevation === "raised" && "shadow-soft",
        elevation === "float" && "shadow-float",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
