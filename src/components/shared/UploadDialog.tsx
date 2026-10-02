import type { ReactNode } from "react";
import { useT } from "@/i18n/useT";
import { CustomDialog } from "./CustomDialog";
import { DropZone } from "./DropZone";
import { Hint } from "./Hint";

/**
 * Every upload button opens this instead of the file picker: drag a file in, choose it from
 * the computer, or paste it, and below that any other way in the place offers (a sample).
 * `onFiles` gets what came in; the caller closes the dialog when it has taken them.
 */
export function UploadDialog({
  title,
  hint,
  accept,
  multiple = false,
  label,
  onFiles,
  onClose,
  children,
}: {
  title: string;
  hint?: string;
  accept?: string;
  multiple?: boolean;
  label?: string;
  onFiles: (files: File[]) => void;
  onClose: () => void;
  /** Other ways in, under the drop zone. */
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <CustomDialog title={title} closeLabel={t("shortcuts.close")} onClose={onClose} width={480}>
      <div className="flex flex-col gap-3">
        {hint && <Hint>{hint}</Hint>}
        <DropZone accept={accept} multiple={multiple} label={label} onFiles={onFiles} />
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </CustomDialog>
  );
}
