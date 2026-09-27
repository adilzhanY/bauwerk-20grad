import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useT } from "@/i18n/useT";
import { CustomField } from "./CustomField";
import { cx } from "./cx";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  /** What the browser's password manager should fill in. */
  autoComplete?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * A form field that reports every keystroke, for forms that are sent as a whole (the login
 * page). CustomTextInput commits on blur instead, for renaming things in the model. A
 * password field has a button to show what was typed.
 */
export function CustomFormInput({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  error,
  hint,
  disabled = false,
  autoFocus = false,
}: Props) {
  const t = useT();
  const id = useId();
  const [shown, setShown] = useState(false);
  const password = type === "password";
  return (
    <CustomField label={label} htmlFor={id} hint={hint} error={error}>
      <div
        className={cx(
          "flex h-10 items-center gap-2 rounded-inner border bg-paper px-3 transition-colors focus-within:border-select",
          error ? "border-mark" : "border-line",
          disabled && "opacity-40",
        )}
      >
        <input
          id={id}
          type={password && shown ? "text" : type}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
        {password && (
          <button
            type="button"
            aria-label={shown ? t("auth.hidePassword") : t("auth.showPassword")}
            aria-pressed={shown}
            onClick={() => {
              setShown(!shown);
            }}
            className="text-muted hover:text-ink"
          >
            {shown ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
          </button>
        )}
      </div>
    </CustomField>
  );
}
