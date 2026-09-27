import { useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useT } from "@/i18n/useT";
import { CustomField } from "./CustomField.tsx";
import { CustomSlider } from "./CustomSlider.tsx";
import { cx } from "./cx.ts";
import { snapToStep } from "./snap.ts";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Show a slider next to the field. */
  slider?: boolean;
  invalid?: boolean;
  hint?: string;
  error?: string;
  disabled?: boolean;
  /** Called on every live change. */
  onChange: (value: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const SCRUB_PIXELS_PER_STEP = 8;

function digitsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-12)));
}

/** Reads a typed number, accepting a comma as the decimal mark. Null when it is not one. */
function parseNumber(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Number field with the unit drawn inside. Typing commits live while the value is inside
 * the range; blur clamps and snaps to the step; Escape reverts. Dragging left or right on
 * the label scrubs the value, Shift makes it ten times finer. Arrow keys step in the field.
 */
export function CustomNumberInput({
  label,
  value,
  min,
  max,
  step,
  unit,
  slider = true,
  invalid = false,
  hint,
  error,
  disabled = false,
  onChange,
  onGestureStart,
  onGestureEnd,
}: Props) {
  const t = useT();
  const id = useId();
  const digits = digitsForStep(step);
  const fmt = (v: number) => v.toFixed(digits);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const gesture = useRef(false);
  const valueAtFocus = useRef(value);
  const cancelBlurCommit = useRef(false);
  const scrub = useRef<{ startX: number; startValue: number } | null>(null);

  const begin = () => {
    if (gesture.current) return;
    gesture.current = true;
    onGestureStart?.();
  };
  const end = () => {
    if (!gesture.current) return;
    gesture.current = false;
    onGestureEnd?.();
  };
  const emit = (next: number) => {
    if (next !== value) onChange(next);
  };

  const onFocus = () => {
    valueAtFocus.current = value;
    cancelBlurCommit.current = false;
    setEditing(true);
    setDraft(fmt(value));
    begin();
  };
  const onText = (text: string) => {
    setDraft(text);
    const parsed = parseNumber(text);
    if (parsed === null || parsed < min || parsed > max) return;
    emit(round(parsed));
  };
  const commitDraft = () => {
    const parsed = parseNumber(draft);
    if (parsed !== null) emit(snapToStep(parsed, min, max, step));
  };
  const onBlur = () => {
    if (cancelBlurCommit.current) cancelBlurCommit.current = false;
    else commitDraft();
    setEditing(false);
    end();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commitDraft();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      cancelBlurCommit.current = true;
      emit(valueAtFocus.current);
      setDraft(fmt(valueAtFocus.current));
      setEditing(false);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? step * 10 : step);
      const next = snapToStep(value + delta, min, max, step);
      setDraft(fmt(next));
      emit(next);
    }
  };

  // Scrubbing on the label.
  const onLabelDown = (e: PointerEvent<HTMLLabelElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub.current = { startX: e.clientX, startValue: value };
    begin();
  };
  const onLabelMove = (e: PointerEvent<HTMLLabelElement>) => {
    if (!scrub.current) return;
    const fine = e.shiftKey ? 0.1 : 1;
    const steps = Math.round(((e.clientX - scrub.current.startX) / SCRUB_PIXELS_PER_STEP) * fine);
    emit(snapToStep(scrub.current.startValue + steps * step, min, max, step));
  };
  const onLabelUp = (e: PointerEvent<HTMLLabelElement>) => {
    if (!scrub.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    scrub.current = null;
    end();
  };

  return (
    <CustomField
      label={label}
      htmlFor={id}
      hint={hint}
      error={error}
      labelProps={{
        onPointerDown: onLabelDown,
        onPointerMove: onLabelMove,
        onPointerUp: onLabelUp,
        onPointerCancel: onLabelUp,
        className: disabled ? undefined : "cursor-ew-resize touch-none",
        title: disabled ? undefined : t("lod2.dragToChange"),
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {slider && (
          <CustomSlider
            label={label}
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onChange={onChange}
            onGestureStart={begin}
            onGestureEnd={end}
            format={(v) => `${fmt(v)}${unit ? ` ${unit}` : ""}`}
          />
        )}
        <div
          className={cx(
            "flex h-[34px] min-w-0 items-center rounded-inner border bg-panel transition-colors focus-within:border-select",
            invalid || error ? "border-mark" : "border-line",
            slider ? "w-28" : "flex-1",
            disabled && "opacity-40",
          )}
        >
          <input
            id={id}
            type="text"
            inputMode="decimal"
            disabled={disabled}
            aria-invalid={invalid || error ? true : undefined}
            value={editing ? draft : fmt(value)}
            onFocus={onFocus}
            onChange={(e) => {
              onText(e.target.value);
            }}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent px-3 font-num text-sm text-ink outline-none"
          />
          {unit && <span className="pr-2 font-num text-xs text-muted">{unit}</span>}
        </div>
      </div>
    </CustomField>
  );
}
