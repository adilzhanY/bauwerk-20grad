import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { CustomIconButton } from "./CustomIconButton";
import { cx } from "./cx";
import { useFadeMotion, useFloatMotion } from "./presenceMotion";

interface Props {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

/** The dialogs open now, the newest last: only the top one answers the keyboard. */
const stack: object[] = [];

/** Escape meant for an open list or menu inside the dialog, which closes that first. */
const inOpenList = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('[aria-expanded="true"], [role="listbox"], [role="menu"]') !== null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Modal with a focus trap. Escape and a click on the backdrop close it; focus returns to the
 * opener. With dialogs stacked, Escape closes only the top one, and not while a control inside
 * used it (an open select list). It renders into the page body: opened from a panel that slides in with a transform
 * (the layers tree, a tab), a fixed overlay would otherwise cover only that panel. The opener mounts it inside `<Presence show={open} kind="float">`, so it fades in
 * and out with the rest of the site.
 */
export function CustomDialog({ title, closeLabel, onClose, children, width = 440 }: Props) {
  const titleId = useId();
  const fade = useFadeMotion();
  const float = useFloatMotion();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    const token = {};
    stack.push(token);
    // On the document as the event bubbles: after the controls inside had it (they mark what
    // they used with preventDefault), before the page's own shortcuts on the window.
    const onKey = (e: KeyboardEvent) => {
      if (stack.at(-1) !== token) return;
      if (e.key === "Escape") {
        if (e.defaultPrevented || inOpenList(e.target)) return;
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      stack.splice(stack.indexOf(token), 1);
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  return createPortal(
    <div
      className={cx(
        "fixed inset-0 z-50 flex items-center justify-center bg-night/40 p-6 backdrop-blur-sm",
        fade,
      )}
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
        }}
        style={{ width, maxWidth: "100%" }}
        className={cx(
          "rounded-card border border-line bg-paper p-5 shadow-float outline-none",
          float,
        )}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
            {title}
          </h2>
          <CustomIconButton label={closeLabel} size="sm" onClick={onClose}>
            <X size={16} />
          </CustomIconButton>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
