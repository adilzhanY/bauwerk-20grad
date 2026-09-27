import type { ReactNode } from "react";
import { ChevronsRight, Footprints, Scissors, SquareDashed } from "lucide-react";
import { cx } from "@/components/cx";
import type { MessageKey } from "@/i18n";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import type { CameraView } from "@/store/building";

const VIEWS: { view: CameraView; letter: MessageKey; label: MessageKey }[] = [
  { view: "3d", letter: "view.3d", label: "view.3dLabel" },
  { view: "top", letter: "view.top", label: "view.topLabel" },
  { view: "n", letter: "view.n", label: "view.nLabel" },
  { view: "e", letter: "view.e", label: "view.eLabel" },
  { view: "s", letter: "view.s", label: "view.sLabel" },
  { view: "w", letter: "view.w", label: "view.wLabel" },
];

/**
 * The view switch at the top of the editor: the 3D view, the view from the top and the four
 * elevations, then the floor plan and the walkthrough, the section cut, and a button that
 * hides or shows the side panels.
 */
export function ViewPill({
  panelsOpen,
  onTogglePanels,
}: {
  panelsOpen: boolean;
  onTogglePanels: () => void;
}) {
  const t = useT();
  const planView = useEditorStore((s) => s.planView);
  const walkthrough = useEditorStore((s) => s.walkthrough);
  const cameraView = useEditorStore((s) => s.cameraView.view);
  const setCameraView = useEditorStore((s) => s.setCameraView);
  const setPlanView = useEditorStore((s) => s.setPlanView);
  const setWalkthrough = useEditorStore((s) => s.setWalkthrough);
  const sectionCut = useEditorStore((s) => s.sectionCut.enabled);
  const setSectionCut = useEditorStore((s) => s.setSectionCut);
  const free = !planView && !walkthrough;

  return (
    <div className="pointer-events-auto flex h-11 items-center gap-0.5 rounded-card border border-line bg-paper p-1 shadow-float">
      <div
        role="radiogroup"
        aria-label={t("editor.projection")}
        className="flex items-center gap-0.5"
      >
        {VIEWS.map(({ view, letter, label }) => {
          const active = free && cameraView === view;
          return (
            <button
              key={view}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={t(label)}
              title={t(label)}
              onClick={() => {
                setCameraView(view);
              }}
              className={cx(
                "flex h-9 min-w-9 items-center justify-center rounded-control px-2.5 text-sm transition-colors",
                active
                  ? "bg-select font-semibold text-white"
                  : "font-medium text-muted hover:bg-panel hover:text-ink",
              )}
            >
              {t(letter)}
            </button>
          );
        })}
      </div>
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      <PillButton
        label={t("editor.plan")}
        pressed={planView}
        onClick={() => {
          setWalkthrough(false);
          setPlanView(!planView);
        }}
      >
        <SquareDashed size={16} aria-hidden />
      </PillButton>
      <PillButton
        label={t("editor.walkthrough")}
        pressed={walkthrough}
        onClick={() => {
          setWalkthrough(!walkthrough);
        }}
      >
        <Footprints size={16} aria-hidden />
      </PillButton>
      <PillButton
        label={t("view.sectionCut")}
        pressed={sectionCut}
        onClick={() => {
          setSectionCut({ enabled: !sectionCut });
        }}
      >
        <Scissors size={16} aria-hidden />
      </PillButton>
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      <PillButton
        label={panelsOpen ? t("editor.hidePanels") : t("editor.showPanels")}
        onClick={onTogglePanels}
      >
        <ChevronsRight
          size={16}
          aria-hidden
          className={cx("transition-transform", !panelsOpen && "rotate-180")}
        />
      </PillButton>
    </div>
  );
}

function PillButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "flex h-9 w-9 items-center justify-center rounded-control transition-colors",
        pressed ? "bg-select-soft text-select" : "text-muted hover:bg-panel hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
