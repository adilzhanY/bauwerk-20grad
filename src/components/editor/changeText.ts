import type { MessageKey } from "@/i18n";
import { CHANGE_KINDS } from "@/sync/summary";
import type { ChangeSummary } from "@/sync/summary";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * A change summary in words, the biggest kinds first: "Walls 3 changed. Doors 2 added". At
 * most `limit` kinds; an empty summary gives an empty string.
 */
export function changeText(summary: ChangeSummary, t: Translate, limit = 3): string {
  const kinds = CHANGE_KINDS.flatMap((kind) => {
    const c = summary[kind];
    const total = c ? c.added + c.removed + c.changed : 0;
    return c && total > 0 ? [{ kind, c, total }] : [];
  })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
  return kinds
    .map(({ kind, c }) => {
      const parts = [
        c.added > 0 ? t("history.added", { n: c.added }) : null,
        c.removed > 0 ? t("history.removed", { n: c.removed }) : null,
        c.changed > 0
          ? kind === "roof" || kind === "outline" || kind === "project"
            ? t("history.changedOne")
            : t("history.changedN", { n: c.changed })
          : null,
      ].filter(Boolean);
      return `${t(`history.kind.${kind}` as MessageKey)} ${parts.join(", ")}`;
    })
    .join(". ");
}
