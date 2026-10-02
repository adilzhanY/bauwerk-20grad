import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useT } from "@/i18n/useT";
import { accepts } from "@/lib/accepts";
import { inTextField } from "@/lib/inTextField";
import { CustomButton } from "./CustomButton";
import { Hint } from "./Hint";
import { Presence } from "./Presence";

/**
 * Where a file goes in: dragged onto it, chosen from the computer with its button, or pasted
 * (Ctrl+V) while it is on screen. Every upload on the site takes files this one way, so all
 * three work everywhere. Files of a type `accept` does not take are refused with a line saying
 * so; `accept` is the file input's own list (".pdf", "image/*", "application/pdf").
 */
export function DropZone({
  accept,
  multiple = false,
  disabled = false,
  label,
  onFiles,
}: {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** What to drop, when more than "a file" helps ("Drag a floor plan here"). */
  label?: string;
  onFiles: (files: File[]) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const take = (list: File[]) => {
    if (disabled || list.length === 0) return;
    const fitting = list.filter((f) => accepts(f, accept));
    const wrong = list.find((f) => !accepts(f, accept));
    setRefused(wrong ? t("upload.wrongType", { name: wrong.name }) : null);
    if (fitting.length > 0) onFiles(multiple ? fitting : fitting.slice(0, 1));
  };

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    if (disabled || inTextField(event.target)) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    take(files.map(named));
  });
  useEffect(() => {
    const listener = (event: ClipboardEvent) => {
      onPaste(event);
    };
    document.addEventListener("paste", listener);
    return () => {
      document.removeEventListener("paste", listener);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(Array.from(e.dataTransfer.files));
        }}
        className={`flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-4 py-7 text-center transition-colors ${
          over ? "border-select bg-select-soft" : "border-line-strong"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <Upload size={22} aria-hidden className={over ? "text-select" : "text-muted"} />
        <p className="text-sm font-medium text-ink">
          {label ?? t(multiple ? "upload.dropMany" : "upload.drop")}
        </p>
        <CustomButton
          disabled={disabled}
          onClick={() => {
            input.current?.click();
          }}
        >
          {t(multiple ? "upload.chooseMany" : "upload.choose")}
        </CustomButton>
        <p className="text-xs text-muted">{t("upload.paste")}</p>
      </div>
      <Presence value={refused}>{(text) => <Hint error>{text}</Hint>}</Presence>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        aria-label={t(multiple ? "upload.chooseMany" : "upload.choose")}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          take(files);
        }}
      />
    </div>
  );
}

/** Pasted images come named "image.png"; one with a clearer name is kept for the upload. */
function named(file: File): File {
  if (file.name && file.name !== "image.png") return file;
  const extension = /\/(\w+)/.exec(file.type)?.[1] ?? "png";
  return new File([file], `pasted.${extension}`, { type: file.type });
}
