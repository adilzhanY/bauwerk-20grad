import { useId } from "react";
import type { KeyboardEvent, Ref } from "react";
import { cx } from "./cx";

/**
 * Several lines of text: a note, a comment. The label is above, or only for screen readers
 * with `hideLabel`. Enter writes a new line; callers decide what Ctrl+Enter does.
 */
export function CustomTextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  hideLabel = false,
  autoFocus,
  maxLength,
  onKeyDown,
  textareaRef,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  hideLabel?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-xs font-medium text-muted"}>
        {label}
      </label>
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="w-full resize-none rounded-inner border border-line bg-panel p-3 text-sm text-ink outline-none placeholder:text-faint focus:border-select"
      />
    </div>
  );
}
