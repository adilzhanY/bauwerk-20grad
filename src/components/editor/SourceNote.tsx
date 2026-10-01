import { Presence } from "@/components/shared/Presence";
import { Card } from "@/components/shared/Card";
import { useMemo } from "react";
import { sourceStatus } from "@/geometry/sources";
import type { SourceKind } from "@/geometry/types";
import type { MessageKey } from "@/i18n";
import { useT } from "@/i18n/useT";
import { sourceNoteText } from "@/lod2/messages";
import { useEditorStore } from "@/store/building";

const KIND_KEYS: Record<SourceKind, MessageKey> = {
  lod2: "source.kind.lod2",
  photo: "source.kind.photo",
  catalogue: "source.kind.catalogue",
  estimate: "source.kind.estimate",
  typed: "source.kind.typed",
};

/**
 * Where the selected value came from, for a building brought in from a survey: the kind of
 * source, the note that came with it and the photo. Once the value has been changed it says
 * so. Renders nothing for a building drawn by hand.
 */
export function SourceNote({ path }: { path: string }) {
  const t = useT();
  // Select the building and derive the status outside the selector: sourceStatus builds a new
  // object on every call, which the store would read as a change on every render.
  const building = useEditorStore((s) => s.building);
  const language = useEditorStore((s) => s.language);
  const status = useMemo(() => sourceStatus(building, path), [building, path]);
  if (!status || status.gone) return null;
  const kind = t(KIND_KEYS[status.source.kind]);
  return (
    <Card inset className="px-3 py-2 text-xs leading-relaxed" data-edited={status.edited}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-muted">{t("source.title")}</span>
        <span className={status.edited ? "text-muted" : "font-medium text-ink"}>
          {status.edited ? t("source.edited", { kind }) : kind}
        </span>
      </div>
      <Presence value={status.edited ? null : (status.source.photo ?? null)}>
        {(photo) => <div className="text-muted">{t("source.photo", { name: photo })}</div>}
      </Presence>
      <Presence value={status.edited ? null : sourceNoteText(status.source, language)}>
        {(note) => <div className="text-muted">{note}</div>}
      </Presence>
    </Card>
  );
}
