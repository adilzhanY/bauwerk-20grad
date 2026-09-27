import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { Box, Eye, Keyboard } from "lucide-react";
import { cx } from "@/components/cx";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import type { Tool } from "@/store/building";
import { ShortcutSheet } from "@/ui/ShortcutSheet";
import { toolIcons, toolLabel } from "@/ui/tools";
import { TOOL_ORDER } from "@/ui/useKeyboardShortcuts";

/** The tools in groups, as the card shows them: pick and move, draw, zone and services, measure. */
const GROUPS: readonly (readonly Tool[])[] = [
  ["select", "move"],
  ["footprint", "interiorWall", "opening"],
  ["zone", "hvac"],
  ["measure"],
];

/**
 * The tool card at the top left of the 3D view. The eye opens the layers panel and the cube
 * shows the whole building solid; below them the tools in groups, each with its keyboard
 * shortcut in a slot of its own beside it, the active tool filled navy; at the bottom the
 * shortcut sheet.
 */
export function ToolDock({
  layersOpen,
  onToggleLayers,
}: {
  layersOpen: boolean;
  onToggleLayers: () => void;
}) {
  const t = useT();
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const otherStoreys = useEditorStore((s) => s.otherStoreys);
  const setOtherStoreys = useEditorStore((s) => s.setOtherStoreys);
  const [sheetOpen, setSheetOpen] = useState(false);
  const whole = otherStoreys.below === "solid" && otherStoreys.above === "ghost";

  return (
    <nav
      aria-label={t("panel.tools")}
      className="pointer-events-auto flex w-16 flex-col items-center gap-1 rounded-card border border-line bg-paper py-1.5 shadow-float"
    >
      <CardButton label={t("tree.toggle")} pressed={layersOpen} onClick={onToggleLayers}>
        <Eye size={18} aria-hidden />
      </CardButton>
      <CardButton
        label={t("editor.wholeBuilding")}
        pressed={whole}
        onClick={() => {
          setOtherStoreys(
            whole
              ? { above: "outline", below: "ghost", roof: "outline" }
              : { above: "ghost", below: "solid", roof: "solid" },
          );
        }}
      >
        <Box size={18} aria-hidden />
      </CardButton>
      <span aria-hidden className="my-1 h-px w-8 bg-line" />
      <div
        role="radiogroup"
        aria-label={t("panel.tools")}
        className="flex flex-col items-center gap-1"
      >
        {GROUPS.map((group, groupIndex) => (
          <Fragment key={group.join()}>
            {groupIndex > 0 && <span aria-hidden className="my-1 h-px w-8 bg-line" />}
            {group.map((id) => {
              const shortcut = String(TOOL_ORDER.indexOf(id) + 1);
              const active = tool === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={t(toolLabel[id])}
                  aria-keyshortcuts={shortcut}
                  title={`${t(toolLabel[id])} (${shortcut})`}
                  onClick={() => {
                    setTool(id);
                  }}
                  className="group relative flex h-9 w-[52px] items-center justify-center"
                >
                  <span
                    className={cx(
                      "flex h-9 w-9 items-center justify-center rounded-control transition-colors",
                      active
                        ? "bg-select text-white"
                        : "text-muted group-hover:bg-panel group-hover:text-ink",
                    )}
                  >
                    {toolIcons[id]}
                  </span>
                  {/* In the gutter beside the square, so the filled active square never hides it. */}
                  <span
                    aria-hidden
                    className="absolute right-0 bottom-0 font-num text-[10px] leading-none font-medium text-faint"
                  >
                    {shortcut}
                  </span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      <span aria-hidden className="my-1 h-px w-8 bg-line" />
      <CardButton
        label={t("bar.shortcuts")}
        onClick={() => {
          setSheetOpen(true);
        }}
      >
        <Keyboard size={17} aria-hidden />
      </CardButton>
      {sheetOpen && (
        <ShortcutSheet
          onClose={() => {
            setSheetOpen(false);
          }}
        />
      )}
    </nav>
  );
}

function CardButton({
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
