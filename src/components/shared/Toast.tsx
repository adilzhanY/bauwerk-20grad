import { X } from "lucide-react";
import type { ReactNode } from "react";
import { CustomIconButton } from "./CustomIconButton";
import { cx } from "./cx";
import { useFloatMotion } from "./presenceMotion";

/**
 * A message floating over the page: something happened (a building arrived by link, an old
 * version is on screen, an edit was taken back). Several go in one ToastStack, so they never
 * cover each other; each one sits in a `<Presence value kind="float">` to arrive and leave.
 */
export function Toast({
  tone = "neutral",
  icon,
  actions,
  dismissLabel,
  onDismiss,
  onHover,
  children,
}: {
  tone?: "neutral" | "info" | "warning";
  icon?: ReactNode;
  actions?: ReactNode;
  /** With onDismiss, a close button at the end. */
  dismissLabel?: string;
  onDismiss?: () => void;
  /** Told when the pointer comes and goes: a toast that times out waits while it is read. */
  onHover?: (hovering: boolean) => void;
  children: ReactNode;
}) {
  const motion = useFloatMotion();
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      onMouseEnter={() => {
        onHover?.(true);
      }}
      onMouseLeave={() => {
        onHover?.(false);
      }}
      className={cx(
        "pointer-events-auto flex max-w-[40rem] items-center gap-3 rounded-card border py-1.5 pr-1.5 pl-4 text-sm shadow-float",
        tone === "warning" && "border-mark bg-mark-soft text-mark",
        tone === "info" && "border-select bg-paper text-ink",
        tone === "neutral" && "border-line bg-paper text-ink",
        motion,
      )}
    >
      {icon !== undefined && <span className="shrink-0 text-select">{icon}</span>}
      <span className="min-w-0">{children}</span>
      {actions}
      {onDismiss && dismissLabel !== undefined && (
        <CustomIconButton label={dismissLabel} size="sm" onClick={onDismiss}>
          <X size={14} aria-hidden />
        </CustomIconButton>
      )}
    </div>
  );
}

/**
 * Where toasts stand: centred near the top of the area, one under the other. "below-bar"
 * starts them under the editor's two bars at the top (tools, then views, 44 px each).
 */
export function ToastStack({
  children,
  offset = "top",
}: {
  children: ReactNode;
  offset?: "top" | "below-bar";
}) {
  return (
    <div
      className={cx(
        "pointer-events-none absolute left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2",
        offset === "top" ? "top-4" : "top-32",
      )}
    >
      {children}
    </div>
  );
}
