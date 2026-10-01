import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** The modals open now, the newest last: only the top one answers the keyboard. */
const stack: object[] = [];

/** Escape meant for an open list or menu inside the modal, which closes that first. */
const inOpenList = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('[aria-expanded="true"], [role="listbox"], [role="menu"]') !== null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * What every modal does with the keyboard (CustomDialog, the photo editor): focus moves into
 * it and back to the opener when it goes, Tab stays inside, and Escape closes it. With modals
 * stacked only the top one reacts, and not to an Escape a control inside already used (an
 * open select list). `active` false: the modal is not open, nothing is bound.
 */
export function useModal(
  panel: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement;
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
      const firstItem = items[0];
      const lastItem = items.at(-1);
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
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [active, panel]);
}
