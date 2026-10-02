import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { CustomButton } from "./CustomButton";
import { CustomDialog } from "./CustomDialog";
import { Hint } from "./Hint";
import { Spinner } from "./Spinner";

/**
 * A picture or a PDF opened in the middle of the page, over the blurred page, as large as
 * the window allows; anything else offers a download. `url` null while it loads. Mounted in
 * `<Presence kind="float">` like every dialog, so it grows in and out.
 */
export function MediaPreview({
  title,
  url,
  mime,
  fileName,
  closeLabel,
  downloadLabel,
  noPreviewLabel,
  failedLabel,
  failed = false,
  actions,
  onClose,
}: {
  /** More buttons before Download, such as Delete. */
  actions?: ReactNode;
  title: string;
  url: string | null;
  mime: string;
  fileName: string;
  closeLabel: string;
  downloadLabel: string;
  noPreviewLabel: string;
  failedLabel: string;
  failed?: boolean;
  onClose: () => void;
}) {
  const image = mime.startsWith("image/");
  const pdf = mime === "application/pdf";
  return (
    <CustomDialog title={title} closeLabel={closeLabel} onClose={onClose} width={1100}>
      <div className="flex flex-col gap-3">
        <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-inner bg-panel">
          {failed ? (
            <Hint error>{failedLabel}</Hint>
          ) : !url ? (
            <Spinner size="md" />
          ) : image ? (
            <img
              src={url}
              alt={title}
              draggable={false}
              className="max-h-[72vh] w-full object-contain"
            />
          ) : pdf ? (
            <iframe src={url} title={title} className="h-[72vh] w-full border-0" />
          ) : (
            <Hint>{noPreviewLabel}</Hint>
          )}
        </div>
        {url && !failed && (
          <div className="flex justify-end gap-2">
            {actions}
            <CustomButton
              icon={<Download size={15} aria-hidden />}
              onClick={() => {
                const link = document.createElement("a");
                link.href = url;
                link.download = fileName;
                link.click();
              }}
            >
              {downloadLabel}
            </CustomButton>
          </div>
        )}
      </div>
    </CustomDialog>
  );
}
