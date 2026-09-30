import { useId, useState } from "react";
import { CustomField } from "@/components/shared/CustomField";
import { cx } from "@/components/shared/cx";

interface Props {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  autoFocus?: boolean;
}

/** Text field that commits on blur or Enter and reverts on Escape, so a rename is one undo step. */
export function CustomTextInput({
  label,
  value,
  onCommit,
  disabled = false,
  hideLabel = false,
  autoFocus = false,
}: Props) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  const commit = () => {
    const next = draft.trim();
    if (next !== "" && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <CustomField
      label={label}
      htmlFor={id}
      labelProps={hideLabel ? { className: "sr-only" } : undefined}
    >
      <div
        className={cx(
          "flex h-10 items-center gap-2 rounded-inner border border-line bg-paper px-3 transition-colors focus-within:border-select",
          disabled && "opacity-40",
        )}
      >
        <input
          id={id}
          type="text"
          value={draft}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(value);
              e.currentTarget.blur();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </div>
    </CustomField>
  );
}
