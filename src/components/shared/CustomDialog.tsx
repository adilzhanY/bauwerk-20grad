import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { CustomIconButton } from "./CustomIconButton";
import { cx } from "./cx";
import { useModal } from "./useModal";
import { useFadeMotion, useFloatMotion } from "./presenceMotion";

interface Props {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

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
  useModal(panel, onClose);

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
