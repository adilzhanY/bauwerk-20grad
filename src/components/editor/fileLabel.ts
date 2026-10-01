import type { MessageKey } from "@/i18n";
import type { Storey } from "@/geometry/types";
import type { ProjectFile } from "@/projects/collab";
import type { PreviewItem } from "./FilePreview";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** What a file of the project is for, by its slot: "Facade photo, wall 3"; null for a plain upload. */
export function fileLabel(
  file: Pick<ProjectFile, "slot">,
  storeys: readonly Pick<Storey, "id" | "name">[],
  t: Translate,
): string | null {
  const slot = file.slot;
  if (!slot) return null;
  if (/^\d+$/.test(slot)) return t("files.slot.facade", { n: Number(slot) + 1 });
  if (slot === "thumbnail") return t("files.slot.thumbnail");
  if (slot === "model") return t("files.slot.model");
  if (slot === "note") return t("files.slot.note");
  if (slot.startsWith("plan-")) {
    const storey = storeys.find((s) => s.id === slot.slice(5))?.name ?? slot.slice(5);
    return t("files.slot.plan", { storey });
  }
  return null;
}

/** A storey's floor plan picture as a preview item. */
export function planPreview(url: string, storeyName: string, word: string): PreviewItem {
  return {
    kind: "url",
    title: `${word}, ${storeyName}`,
    url,
    mime: "image/png",
    fileName: `${word} ${storeyName}.png`,
  };
}
