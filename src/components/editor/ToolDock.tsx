import { Card } from "@/components/shared/Card";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { Presence } from "@/components/shared/Presence";
import { Fragment, useState } from "react";
import { Box, Eye, Keyboard } from "lucide-react";
import { cx } from "@/components/shared/cx";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { toolAllowed } from "@/store/building";
import type { Tool } from "@/store/building";
import { ShortcutSheet } from "@/components/editor/ShortcutSheet";
import { toolIcons, toolLabel } from "@/components/editor/tools";
import { TOOL_ORDER } from "@/components/editor/useKeyboardShortcuts";

/** The tools in groups, as the card shows them: pick and move, draw, zone and services, measure. */
const GROUPS: readonly (readonly Tool[])[] = [
  ["select"],
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
  const role = useEditorStore((s) => s.projectRole);
  const otherStoreys = useEditorStore((s) => s.otherStoreys);
  // A viewer or commenter sees only the tools that look; empty groups go with their divider.
  const groups = GROUPS.map((g) => g.filter((id) => toolAllowed(id, role))).filter(
    (g) => g.length > 0,
  );
  const setOtherStoreys = useEditorStore((s) => s.setOtherStoreys);
  const [sheetOpen, setSheetOpen] = useState(false);
  const whole = otherStoreys.below === "solid" && otherStoreys.above === "ghost";

  return (
    <Card
      as="nav"
      aria-label={t("panel.tools")}
      elevation="float"
      className="pointer-events-auto flex w-16 flex-col items-center gap-1 py-1.5"
    >
      <CustomIconButton label={t("tree.toggle")} pressed={layersOpen} onClick={onToggleLayers}>
        <Eye size={18} aria-hidden />
      </CustomIconButton>
      <CustomIconButton
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
      </CustomIconButton>
      <span aria-hidden className="my-1 h-px w-8 bg-line" />
      <div
        role="radiogroup"
        aria-label={t("panel.tools")}
        className="flex flex-col items-center gap-1"
      >
        {groups.map((group, groupIndex) => (
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
      <CustomIconButton
        label={t("bar.shortcuts")}
        onClick={() => {
          setSheetOpen(true);
        }}
      >
        <Keyboard size={17} aria-hidden />
      </CustomIconButton>
      <Presence show={sheetOpen} kind="float">
        <ShortcutSheet
          onClose={() => {
            setSheetOpen(false);
          }}
        />
      </Presence>
    </Card>
  );
}
