import { Plus } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { cx } from "@/components/shared/cx";
import { useT } from "@/i18n/useT";
import { can } from "@/projects/roles";
import { useEditorStore } from "@/store/building";
import { storeyShortName } from "@/components/editor/storeyName";

/**
 * The storey card at the left of the 3D view: "+" adds a storey on top, then the top storey
 * first, the ground floor at the bottom, the active one filled navy.
 */
export function StoreyPill() {
  const t = useT();
  const storeys = useEditorStore((s) => s.building.storeys);
  const language = useEditorStore((s) => s.language);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const setActiveStorey = useEditorStore((s) => s.setActiveStorey);
  const addStorey = useEditorStore((s) => s.addStorey);
  const role = useEditorStore((s) => s.projectRole);
  const canEdit = role === null || can(role, "edit");

  return (
    <Card
      as="nav"
      aria-label={t("editor.storeys")}
      elevation="float"
      className="pointer-events-auto flex w-14 flex-col items-center gap-1 py-1.5"
    >
      {canEdit && (
        <>
          <CustomIconButton label={t("storey.add")} onClick={addStorey}>
            <Plus size={16} aria-hidden />
          </CustomIconButton>
          <span aria-hidden className="my-0.5 h-px w-8 bg-line" />
        </>
      )}
      {[...storeys].reverse().map((storey, i) => {
        const active = storey.id === activeStoreyId;
        const index = storeys.length - 1 - i;
        return (
          <button
            key={storey.id}
            type="button"
            aria-label={storey.name}
            title={storey.name}
            aria-current={active ? "true" : undefined}
            onClick={() => {
              setActiveStorey(storey.id);
            }}
            className={cx(
              "flex h-9 w-9 items-center justify-center rounded-control font-num text-xs font-medium transition-colors",
              active ? "bg-select text-white" : "text-muted hover:bg-panel hover:text-ink",
            )}
          >
            {storeyShortName(index, storey.name, language)}
          </button>
        );
      })}
    </Card>
  );
}
