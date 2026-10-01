import { useEffect, useRef, useState } from "react";
import { Camera, FileText, Image, Images, Trash2, Upload } from "lucide-react";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { edges } from "@/geometry/polygon";
import { useT } from "@/i18n/useT";
import { can } from "@/projects/roles";
import { reloadFiles, removeFile, uploadFiles, useProjectFiles } from "@/projects/files";
import { FILE_TYPES } from "@/projects/collab";
import { useEditorStore } from "@/store/building";
import { LayerGroup, LayerRow, RowAction } from "./LayerRow";
import type { PreviewItem } from "./FilePreview";
import { fileLabel, planPreview } from "./fileLabel";

/** One empty list, so the store selectors return the same value every time. */
const NONE: never[] = [];

/** A picture as the row's icon, so the tree shows what it holds. */
function Thumb({ url }: { url: string }) {
  return <img src={url} alt="" draggable={false} className="h-4 w-4 rounded-sm object-cover" />;
}

/**
 * The building's pictures and files in the layers tree, for the whole building, not one
 * storey: the facade photo of every outside wall (or a way to add one), the floor plans of the
 * storeys, and the files of the project. A click previews it in the middle of the page. This is
 * the one place for the project's files: editors upload here and delete a file with two clicks.
 */
export function MediaLayers({ onPreview }: { onPreview: (item: PreviewItem) => void }) {
  const t = useT();
  const footprint = useEditorStore((s) => s.building.footprint);
  const shared = useEditorStore((s) => s.building.sharedEdges ?? NONE);
  const storeys = useEditorStore((s) => s.building.storeys);
  const photos = useEditorStore((s) => s.facadePhotos);
  const plans = useEditorStore((s) => s.floorPlanImages);
  const openPhoto = useEditorStore((s) => s.setPhotoWall);
  const highlight = useEditorStore((s) => s.setHighlightedWall);

  // A row that goes away while hovered (the folder closes) leaves no wall lit.
  useEffect(
    () => () => {
      highlight(null);
    },
    [highlight],
  );
  const projectId = useEditorStore((s) => s.projectId);
  const role = useEditorStore((s) => s.projectRole);
  const editor = role === null || can(role, "edit");
  const files = useProjectFiles((s) => (s.projectId === projectId ? s.files : null)) ?? NONE;
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectId) void reloadFiles(projectId);
  }, [projectId]);

  const walls = edges(footprint);
  const plansShown = storeys.filter((s) => plans[s.id]);
  // Photos and plans already have their own rows; the rest are the person's own uploads.
  const own = files.filter((f) => fileLabel(f, storeys, t) === null);
  const photoCount = walls.filter((w) => photos[w.index]).length;
  const total = photoCount + plansShown.length + own.length;

  return (
    <LayerGroup
      level={1}
      icon={<Images size={14} />}
      label={t("tree.media")}
      count={total}
      alwaysOpenable
    >
      <LayerGroup level={2} label={t("tree.facadePhotos")} count={photoCount} alwaysOpenable>
        {walls.map((wall) => {
          const photo = photos[wall.index];
          const n = wall.index + 1;
          const isShared = shared.includes(wall.index);
          return (
            <LayerRow
              key={wall.index}
              level={3}
              icon={photo ? <Thumb url={photo.url} /> : <Camera size={13} />}
              label={t("tree.wallPhoto", { n })}
              meta={photo ? undefined : isShared ? t("tree.sharedWall") : t("tree.noPhoto")}
              muted={!photo}
              onHover={(on) => {
                highlight(on ? wall.index : null);
              }}
              onSelect={() => {
                if (photo) {
                  onPreview({
                    kind: "url",
                    title: t("files.slot.facade", { n }),
                    url: photo.url,
                    mime: "image/jpeg",
                    fileName: `wall-${String(n)}.jpg`,
                  });
                } else if (editor) openPhoto(wall.index);
              }}
              actions={
                editor && (
                  <RowAction
                    label={photo ? t("tree.replacePhoto", { n }) : t("tree.addPhoto", { n })}
                    onClick={() => {
                      openPhoto(wall.index);
                    }}
                  >
                    <Camera size={13} />
                  </RowAction>
                )
              }
            />
          );
        })}
      </LayerGroup>
      {plansShown.length > 0 && (
        <LayerGroup level={2} label={t("tree.floorPlans")} count={plansShown.length}>
          {plansShown.map((storey) => {
            const plan = plans[storey.id];
            if (!plan) return null;
            return (
              <LayerRow
                key={storey.id}
                level={3}
                icon={<Thumb url={plan.url} />}
                label={storey.name}
                onSelect={() => {
                  onPreview(planPreview(plan.url, storey.name, t("tree.floorPlan")));
                }}
              />
            );
          })}
        </LayerGroup>
      )}
      <LayerGroup
        level={2}
        label={t("tree.files")}
        count={own.length}
        alwaysOpenable
        actions={
          editor &&
          projectId && (
            <RowAction
              label={busy ? t("tree.uploading", { name: busy }) : t("tree.uploadFile")}
              disabled={busy !== null}
              onClick={() => input.current?.click()}
            >
              <Upload size={13} />
            </RowAction>
          )
        }
      >
        {!projectId && (
          <LayerRow level={3} label={t("tree.serverOnly")} muted onSelect={() => undefined} />
        )}
        {own.map((file) => (
          <LayerRow
            key={file.id}
            level={3}
            icon={file.mime.startsWith("image/") ? <Image size={13} /> : <FileText size={13} />}
            label={file.name}
            onSelect={() => {
              if (projectId) onPreview({ kind: "file", title: file.name, projectId, file });
            }}
            actions={
              editor &&
              projectId && (
                <RowAction
                  label={
                    confirming === file.id
                      ? t("files.deleteConfirm")
                      : t("files.delete", { name: file.name })
                  }
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
                </RowAction>
              )
            }
          />
        ))}
        <li role="none">
          <Presence show={problems.length > 0} className="flex flex-col gap-1 px-3 py-1">
            {problems.map((p) => (
              <Hint key={p} error>
                {p}
              </Hint>
            ))}
          </Presence>
        </li>
      </LayerGroup>
      {projectId && (
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          aria-label={t("tree.uploadFile")}
          accept={[...FILE_TYPES].join(",")}
          onChange={(e) => {
            const picked = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            void uploadFiles(projectId, picked, setBusy)
              .then((found) => {
                setProblems(found.map((p) => t(`files.${p.reason}`, { name: p.name })));
              })
              .finally(() => {
                setBusy(null);
              });
          }}
        />
      )}
    </LayerGroup>
  );
}
