import { Card } from "@/components/shared/Card";
import { cx } from "@/components/shared/cx";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { storeyShortName } from "@/components/editor/storeyName";

/**
 * The storey card at the left of the 3D view: the top storey first, the ground floor at the
 * bottom, the active one filled navy. The whole building is the cube in the tool card.
 */
export function StoreyPill() {
  const t = useT();
  const storeys = useEditorStore((s) => s.building.storeys);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const setActiveStorey = useEditorStore((s) => s.setActiveStorey);

  return (
    <Card
      as="nav"
      aria-label={t("editor.storeys")}
      elevation="float"
      className="pointer-events-auto flex w-14 flex-col items-center gap-1 py-1.5"
    >
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
            {storeyShortName(index, storey.name)}
          </button>
        );
      })}
    </Card>
  );
}
