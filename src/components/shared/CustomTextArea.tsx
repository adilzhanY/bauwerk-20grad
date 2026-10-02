import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { cx } from "./cx";

const BOX = "w-full rounded-inner border p-3 text-sm whitespace-pre-wrap break-words";

/**
 * Several lines of text: a note, a comment. The label is above, or only for screen readers
 * with `hideLabel`. Enter writes a new line; callers decide what Ctrl+Enter does.
 *
 * `highlight` draws the text again behind a transparent textarea, in the same box and font,
 * so parts of it can take a colour (an @mention) while typing, selecting and the caret stay
 * the browser's own. It may only change colours, never sizes or weights, or the two layers
 * would no longer line up.
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
  highlight,
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
  highlight?: (value: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const mirror = useRef<HTMLDivElement>(null);
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-xs font-medium text-muted"}>
        {label}
      </label>
      <div className="relative">
        {highlight && (
          <div
            ref={mirror}
            aria-hidden
            className={cx(
              BOX,
              "absolute inset-0 overflow-hidden border-transparent bg-panel text-ink",
            )}
          >
            {highlight(value)}
            {/* A last empty line still takes its height, as in the textarea. */}
            {"\n"}
          </div>
        )}
        <textarea
          id={id}
          ref={textareaRef}
          value={value}
          rows={rows}
          autoFocus={autoFocus}
          maxLength={maxLength}
          placeholder={placeholder}
          onKeyDown={onKeyDown}
          spellCheck={highlight ? false : undefined}
          onScroll={(e) => {
            if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className={cx(
            BOX,
            "relative block resize-none border-line outline-none placeholder:text-faint focus:border-select",
            // No scrollbar over the highlight: it would narrow the text and the layers drift.
            highlight
              ? "bg-transparent text-transparent caret-ink [scrollbar-width:none]"
              : "bg-panel text-ink",
          )}
        />
      </div>
    </div>
  );
}
