import { useEffect, useState } from "react";
import { FileText, Image, Trash2, Upload } from "lucide-react";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { CustomSection } from "@/components/shared/CustomField";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { UploadDialog } from "@/components/shared/UploadDialog";
import { useT } from "@/i18n/useT";
import type { ProjectFile } from "@/projects/collab";
import { reloadFiles, removeFile, uploadFiles, useProjectFiles } from "@/projects/files";
import { can } from "@/projects/roles";
import { useEditorStore } from "@/store/building";
import { SurveyRow } from "./SurveyRow";
import type { PreviewItem } from "./FilePreview";
import { fileLabel } from "./fileLabel";

/** One empty list, so the store selector returns the same value every time. */
const NONE: ProjectFile[] = [];

/**
 * The project's own files (offers, old drawings, notes): the one place for them. Facade
 * photos and floor plans have their rows with their wall and storey. Editors upload here and
 * delete a file with two clicks; everyone with access opens one in the middle of the page.
 */
export function FilesSection({ onPreview }: { onPreview: (item: PreviewItem) => void }) {
  const t = useT();
  const storeys = useEditorStore((s) => s.building.storeys);
  const projectId = useEditorStore((s) => s.projectId);
  const role = useEditorStore((s) => s.projectRole);
  const editor = role === null || can(role, "edit");
  const files = useProjectFiles((s) => (s.projectId === projectId ? s.files : null)) ?? NONE;
  const loadFailed = useProjectFiles((s) => s.failed);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (projectId) void reloadFiles(projectId);
  }, [projectId]);

  const own = files.filter((f) => fileLabel(f, storeys, t) === null);

  return (
    <CustomSection
      title={t("tree.files")}
      action={
        editor &&
        projectId && (
          <CustomIconButton
            label={busy ? t("tree.uploading", { name: busy }) : t("tree.uploadFile")}
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setUploading(true);
            }}
          >
            <Upload size={15} />
          </CustomIconButton>
        )
      }
    >
      <Presence show={!projectId}>
        <Hint>{t("tree.serverOnly")}</Hint>
      </Presence>
      <Presence show={loadFailed}>
        <Hint error>{t("files.loadFailed")}</Hint>
      </Presence>
      <Presence show={problems.length > 0} className="flex flex-col gap-1">
        {problems.map((p) => (
          <Hint key={p} error>
            {p}
          </Hint>
        ))}
      </Presence>
      <Presence show={projectId !== null && own.length === 0}>
        <Hint>{t("files.empty")}</Hint>
      </Presence>
      {own.length > 0 && (
        <ul className="-mx-2 flex flex-col">
          {own.map((file) => (
            <SurveyRow
              key={file.id}
              icon={file.mime.startsWith("image/") ? <Image size={14} /> : <FileText size={14} />}
              label={file.name}
              onSelect={() => {
                if (projectId) onPreview({ kind: "file", title: file.name, projectId, file });
              }}
              action={
                editor &&
                projectId && (
                  <CustomIconButton
                    label={
                      confirming === file.id
                        ? t("files.deleteConfirm")
                        : t("files.delete", { name: file.name })
                    }
                    size="xs"
                    pressed={confirming === file.id}
                    onClick={() => {
                      if (confirming !== file.id) {
                        setConfirming(file.id);
                        return;
                      }
                      setConfirming(null);
                      void removeFile(projectId, file.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </CustomIconButton>
                )
              }
            />
          ))}
        </ul>
      )}
      <Presence value={uploading ? projectId : null} kind="float">
        {(id) => (
          <UploadDialog
            title={t("tree.uploadFile")}
            hint={t("files.uploadHint")}
            multiple
            onClose={() => {
              setUploading(false);
            }}
            onFiles={(picked) => {
              setUploading(false);
              // The server says which files it does not take (type, size); each gets a line.
              void uploadFiles(id, picked, setBusy)
                .then((found) => {
                  setProblems(found.map((p) => t(`files.${p.reason}`, { name: p.name })));
                })
                .finally(() => {
                  setBusy(null);
                });
            }}
          />
        )}
      </Presence>
    </CustomSection>
  );
}
