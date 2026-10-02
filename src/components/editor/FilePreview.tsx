import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "@/i18n/useT";
import { fileBlob } from "@/projects/collab";
import type { ProjectFile } from "@/projects/collab";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { MediaPreview } from "@/components/shared/MediaPreview";
import { Presence } from "@/components/shared/Presence";

/** Deleting what is shown: the button's label, the question asked first, and the deletion. */
export interface PreviewRemove {
  label: string;
  title: string;
  body: string;
  run: () => void;
}

/** Something to show in the preview: a picture the editor already holds, or a project file. */
export type PreviewItem =
  | {
      kind: "url";
      title: string;
      url: string;
      mime: string;
      fileName: string;
      remove?: PreviewRemove;
    }
  | { kind: "file"; title: string; projectId: string; file: ProjectFile };

/** A project file or picture opened in the middle of the page (shared MediaPreview). */
export function FilePreview({ item, onClose }: { item: PreviewItem; onClose: () => void }) {
  const t = useT();
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileId = item.kind === "file" ? item.file.id : null;
  const projectId = item.kind === "file" ? item.projectId : null;
  const remove = item.kind === "url" ? item.remove : undefined;

  useEffect(() => {
    if (!fileId || !projectId) return;
    let made: string | null = null;
    let live = true;
    fileBlob(projectId, fileId)
      .then((blob) => {
        made = URL.createObjectURL(blob);
        if (live) setLoaded({ id: fileId, url: made });
        else URL.revokeObjectURL(made);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [fileId, projectId]);

  const url = item.kind === "url" ? item.url : loaded?.id === item.file.id ? loaded.url : null;
  return (
    <>
      <MediaPreview
        title={item.title}
        url={url}
        mime={item.kind === "url" ? item.mime : item.file.mime}
        fileName={item.kind === "url" ? item.fileName : item.file.name}
        closeLabel={t("preview.close")}
        downloadLabel={t("preview.download")}
        noPreviewLabel={t("preview.none")}
        failedLabel={t("preview.failed")}
        failed={failed}
        onClose={onClose}
        actions={
          remove && (
            <CustomButton
              variant="danger"
              icon={<Trash2 size={15} aria-hidden />}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {remove.label}
            </CustomButton>
          )
        }
      />
      <Presence value={confirming ? remove : null} kind="float">
        {(r) => (
          <CustomDialog
            title={r.title}
            closeLabel={t("common.cancel")}
            onClose={() => {
              setConfirming(false);
            }}
          >
            <p className="text-sm leading-relaxed text-ink">{r.body}</p>
            <div className="mt-5 flex justify-end gap-2">
              <CustomButton
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t("common.cancel")}
              </CustomButton>
              <CustomButton
                variant="danger"
                icon={<Trash2 size={15} aria-hidden />}
                onClick={() => {
                  r.run();
                  setConfirming(false);
                  onClose();
                }}
              >
                {r.label}
              </CustomButton>
            </div>
          </CustomDialog>
        )}
      </Presence>
    </>
  );
}
