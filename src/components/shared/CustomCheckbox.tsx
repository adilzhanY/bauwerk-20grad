import { useId } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check } from "lucide-react";
import { cx } from "@/components/shared/cx";

interface Props {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Draw as a switch (role switch) instead of a box. */
  variant?: "box" | "switch";
}

/** Drawn checkbox or switch. Space toggles, the label toggles, focus ring on the control. */
export function CustomCheckbox({
  label,
  checked,
  onChange,
  disabled = false,
  variant = "box",
}: Props) {
  const id = useId();
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  };
  return (
    <div className={cx("flex items-center gap-2.5", disabled && "opacity-40")}>
      <span
        id={id}
        role={variant === "switch" ? "switch" : "checkbox"}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        aria-labelledby={`${id}-label`}
        tabIndex={disabled ? -1 : 0}
        onClick={toggle}
        onKeyDown={onKeyDown}
        className={cx(
          "inline-flex shrink-0 items-center transition-colors",
          variant === "switch"
            ? cx(
                "h-6 w-11 rounded-full border p-0.5",
                checked ? "border-ink bg-ink" : "border-line-strong bg-panel-2",
              )
            : cx(
                "h-5 w-5 justify-center rounded-soft border",
                checked ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper",
              ),
          disabled && "cursor-not-allowed",
        )}
      >
        {variant === "switch" ? (
          <span
            aria-hidden
            className={cx(
              "h-4 w-4 rounded-full bg-paper shadow-sm transition-transform",
              checked && "translate-x-5",
            )}
          />
        ) : (
          checked && <Check size={14} strokeWidth={3} aria-hidden />
        )}
      </span>
      <label
        id={`${id}-label`}
        onClick={toggle}
        className={cx("text-sm text-ink select-none", !disabled && "cursor-pointer")}
      >
        {label}
      </label>
    </div>
  );
}
