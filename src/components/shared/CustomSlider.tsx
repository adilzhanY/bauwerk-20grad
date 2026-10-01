import { useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { cx } from "@/components/shared/cx";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  /** Called on every change while dragging or stepping. */
  onChange: (value: number) => void;
  /** Called when a drag or key gesture starts and ends, for history batching. */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** Formats the value bubble. */
  format?: (value: number) => string;
}

import { snapToStep } from "@/components/shared/snap";

/**
 * Own slider: a track, a fill and a thumb. Pointer capture makes dragging work
 * even when the pointer leaves the track. Arrow keys step, Shift steps by ten,
 * Home and End jump. The value bubble shows while the slider is active.
 */
export function CustomSlider({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
  onGestureStart,
  onGestureEnd,
  format,
}: Props) {
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const gesture = useRef(false);
  // Clamped: a value outside the range (set elsewhere, or an older project) pins the thumb to
  // the end of the track instead of drawing it past the end, over the field beside it.
  const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

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

  const valueAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return value;
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return snapToStep(min + r * (max - min), min, max, step);
  };

  const emit = (next: number) => {
    if (next !== value) onChange(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
    begin();
    emit(valueAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!gesture.current || !active) return;
    emit(valueAt(e.clientX));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setActive(false);
    end();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = e.shiftKey ? step * 10 : step;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = value + big;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = value - big;
        break;
      case "PageUp":
        next = value + step * 10;
        break;
      case "PageDown":
        next = value - step * 10;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    begin();
    emit(snapToStep(next, min, max, step));
  };

  return (
    <div className="relative flex h-10 min-w-0 flex-1 items-center">
      <div
        ref={track}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format ? format(value) : String(value)}
        aria-disabled={disabled || undefined}
        data-active={active || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onKeyUp={end}
        onBlur={end}
        className={cx(
          "group relative h-10 w-full touch-none rounded-control select-none",
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        <div className="absolute top-1/2 left-0 right-0 h-0.5 -translate-y-1/2 rounded-full bg-line" />
        <div
          className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 rounded-full bg-ink"
          style={{ width: `${ratio * 100}%` }}
        />
        <div
          aria-hidden
          className={cx(
            "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-paper transition-transform",
            "group-hover:scale-110",
            active && "scale-125 border-select",
          )}
          style={{ left: `${ratio * 100}%` }}
        />
        {active && (
          <div
            aria-hidden
            className="absolute -top-7 -translate-x-1/2 rounded-soft bg-ink px-2 py-0.5 font-num text-xs text-paper"
            style={{ left: `${ratio * 100}%` }}
          >
            {format ? format(value) : value}
          </div>
        )}
      </div>
    </div>
  );
}
