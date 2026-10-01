import { useEffect, useRef, useState } from "react";
import { FileText, Image, Trash2, Upload } from "lucide-react";
import { useT } from "@/i18n/useT";
import { formatRelative } from "@/lib/format";
import { FILE_TYPES } from "@/projects/collab";
import type { ProjectFile } from "@/projects/collab";
import { reloadFiles, removeFile, uploadFiles, useProjectFiles } from "@/projects/files";
import { can } from "@/projects/roles";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { FilePreview } from "./FilePreview";
import { fileLabel } from "./fileLabel";

/** Bytes as a short size: 820 KB, 3.2 MB. */
function size(bytes: number, language: string): string {
  const mb = bytes / 1_048_576;
  const format = (n: number, digits: number) =>
    n.toLocaleString(language === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: digits });
  return mb >= 1 ? `${format(mb, 1)} MB` : `${format(Math.max(1, bytes / 1024), 0)} KB`;
}

/**
 * Every file of the open server project (TODO Part 21, CD.5): what each belongs to, who added
 * it and when. Editors upload and delete; everyone with access opens them.
 */
export function FilesPanel() {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId);
  const role = useEditorStore((s) => s.projectRole);
  const storeys = useEditorStore((s) => s.building.storeys);
  const language = useEditorStore((s) => s.language);
  const editor = role === null || can(role, "edit");
  const files = useProjectFiles((s) => (s.projectId === projectId ? s.files : null));
  const loadFailed = useProjectFiles((s) => s.failed);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectId) void reloadFiles(projectId);
  }, [projectId]);

  if (!projectId) return null;

  const label = (file: ProjectFile) => fileLabel(file, storeys, t);

  const upload = async (list: FileList) => {
    const found = await uploadFiles(projectId, Array.from(list), setBusy);
    setBusy(null);
    setProblems(found.map((p) => t(`files.${p.reason}`, { name: p.name })));
  };

  return (
    <div className="flex flex-col gap-3">
      <Hint>{t("files.hint")}</Hint>
      {editor && (
        <>
          <CustomButton
            icon={<Upload size={15} aria-hidden />}
            loading={busy !== null}
            onClick={() => input.current?.click()}
          >
            {busy ? t("files.uploading", { name: busy }) : t("files.upload")}
          </CustomButton>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            aria-label={t("files.upload")}
            accept={[...FILE_TYPES].join(",")}
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      )}
      <Presence show={loadFailed}>
        <Hint error>{t("files.loadFailed")}</Hint>
      </Presence>
      <Presence show={problems.length > 0}>
        <div className="flex flex-col gap-1">
          {problems.map((p) => (
            <Hint key={p} error>
              {p}
            </Hint>
          ))}
        </div>
      </Presence>
      {files?.length === 0 && <Hint>{t("files.empty")}</Hint>}
      <ul className="flex flex-col">
        {(files ?? []).map((file) => {
          const what = label(file);
          const who = file.uploadedBy
            ? `${file.uploadedBy.firstName} ${file.uploadedBy.lastName}`
            : null;
          return (
            <li
              key={file.id}
              className="flex items-center gap-2.5 border-b border-line py-2 last:border-0"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-soft bg-panel text-muted">
                {file.mime.startsWith("image/") ? (
                  <Image size={16} aria-hidden />
                ) : (
                  <FileText size={16} aria-hidden />
                )}
              </span>
              <button
                type="button"
                aria-label={t("files.open", { name: file.name })}
                onClick={() => {
                  setPreview(file);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-medium text-ink">
                  {what ?? file.name}
                </span>
                <span className="block truncate text-xs text-muted">
                  {[
                    size(file.size, language),
                    who
                      ? t("files.by", { name: who, when: formatRelative(file.createdAt, language) })
                      : formatRelative(file.createdAt, language),
                  ].join(" · ")}
                </span>
              </button>
              {editor && (
                <CustomIconButton
                  label={
                    confirming === file.id
                      ? t("files.deleteConfirm")
                      : t("files.delete", { name: what ?? file.name })
                  }
                  size="sm"
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
                  <Trash2 size={15} aria-hidden />
                </CustomIconButton>
              )}
            </li>
          );
        })}
      </ul>
      <Presence value={preview} kind="float">
        {(file) => (
          <FilePreview
            item={{ kind: "file", title: label(file) ?? file.name, projectId, file }}
            onClose={() => {
              setPreview(null);
            }}
          />
        )}
      </Presence>
    </div>
  );
}
