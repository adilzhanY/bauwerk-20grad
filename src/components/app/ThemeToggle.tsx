import { Moon, Sun } from "lucide-react";
import type { MouseEvent } from "react";
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { cx } from "@/components/shared/cx";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function media(query: string): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

function subscribeSystemDark(onChange: () => void): () => void {
  const list = media(DARK_QUERY);
  list?.addEventListener("change", onChange);
  return () => list?.removeEventListener("change", onChange);
}

function systemDark(): boolean {
  return media(DARK_QUERY)?.matches ?? false;
}

/**
 * Light and dark switch in the top bar, after the one on the portfolio site. The new theme
 * wipes in as a circle growing out of the button (View Transitions API, 550 ms); browsers
 * without it get a 350 ms colour cross-fade, and reduced motion switches at once. The sun
 * and moon cross-fade with a quarter turn. It writes the same store value as the theme
 * setting, so a "system" choice becomes an explicit light or dark on the first click.
 */
export function ThemeToggle() {
  const t = useT();
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);
  const osDark = useSyncExternalStore(subscribeSystemDark, systemDark);
  const dark = theme === "dark" || (theme === "system" && osDark);
  const label = dark ? t("theme.toLight") : t("theme.toDark");

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    const next = dark ? "light" : "dark";
    // The persistence layer stamps data-theme synchronously; flushSync puts the new icon in
    // the same frame so the transition snapshot shows it.
    const apply = () => {
      flushSync(() => {
        setTheme(next);
      });
    };

    if (media("(prefers-reduced-motion: reduce)")?.matches) {
      apply();
      return;
    }

    if (typeof document.startViewTransition !== "function") {
      root.classList.add("theme-anim");
      apply();
      window.setTimeout(() => {
        root.classList.remove("theme-anim");
      }, 400);
      return;
    }

    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(apply);
    void transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 550,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={toggle}
      className="relative flex size-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-panel hover:text-ink"
    >
      <Sun aria-hidden className={cx("theme-toggle-icon", dark && "is-hidden")} />
      <Moon aria-hidden className={cx("theme-toggle-icon", !dark && "is-hidden")} />
    </button>
  );
}
