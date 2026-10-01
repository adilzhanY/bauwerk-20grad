import { useRef, useState } from "react";
import { ChevronDown, ListTree } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { MenuItem, Popover } from "@/components/shared/Popover";
import { Presence } from "@/components/shared/Presence";
import { cx } from "@/components/shared/cx";
import { useDismiss } from "@/components/shared/useDismiss";
import { useT } from "@/i18n/useT";
import { toolAllowed, useEditorStore } from "@/store/building";
import type { Tool } from "@/store/building";
import { MAIN_TOOLS, MORE_TOOLS, toolIcons, toolKey, toolLabel } from "./tools";

/**
 * The tool bar across the top of the 3D view: the survey panel's toggle, then the survey
 * tools, each one click with its number key inside the button, and "More" for the rarer
 * ones (outline, zone, heating). With room to spare the buttons carry their names too.
 */
export function ToolBar({
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
  // A viewer or commenter sees only the tools that look.
  const main = MAIN_TOOLS.filter((id) => toolAllowed(id, role));
  const more = MORE_TOOLS.filter((id) => toolAllowed(id, role));

  return (
    <Card
      as="nav"
      aria-label={t("panel.tools")}
      elevation="float"
      className="pointer-events-auto flex h-11 items-center gap-0.5 p-1"
    >
      <CustomIconButton label={t("tree.toggle")} pressed={layersOpen} onClick={onToggleLayers}>
        <ListTree size={18} aria-hidden />
      </CustomIconButton>
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      <div role="radiogroup" aria-label={t("panel.tools")} className="flex items-center gap-0.5">
        {main.map((id) => (
          <ToolButton
            key={id}
            tool={id}
            active={tool === id}
            onClick={() => {
              setTool(id);
            }}
          />
        ))}
      </div>
      {more.length > 0 && (
        <>
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          <MoreTools tools={more} />
        </>
      )}
    </Card>
  );
}

function ToolButton({
  tool,
  active,
  onClick,
}: {
  tool: Tool;
  active: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const key = toolKey(tool);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={t(toolLabel[tool])}
      aria-keyshortcuts={key}
      title={`${t(toolLabel[tool])} (${key})`}
      onClick={onClick}
      className={cx(
        "flex h-9 items-center gap-1.5 rounded-control px-2 text-sm transition-colors",
        active ? "bg-select font-semibold text-white" : "text-muted hover:bg-panel hover:text-ink",
      )}
    >
      {toolIcons[tool]}
      <span aria-hidden className="hidden @min-[54rem]:inline">
        {t(toolLabel[tool])}
      </span>
      <span
        aria-hidden
        className={cx(
          "font-num text-[11px] leading-none font-medium",
          active ? "text-white/75" : "text-faint",
        )}
      >
        {key}
      </span>
    </button>
  );
}

/** "More": the tools a survey needs rarely. Shows the chosen one while it is active. */
function MoreTools({ tools }: { tools: readonly Tool[] }) {
  const t = useT();
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, root, () => {
    setOpen(false);
  });
  const current = tools.includes(tool) ? tool : null;
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current ? `${t("tool.more")}: ${t(toolLabel[current])}` : t("tool.more")}
        title={t("tool.more")}
        onClick={() => {
          setOpen(!open);
        }}
        className={cx(
          "flex h-9 items-center gap-1.5 rounded-control px-2 text-sm transition-colors",
          current
            ? "bg-select font-semibold text-white"
            : "text-muted hover:bg-panel hover:text-ink",
        )}
      >
        {current && toolIcons[current]}
        <span className={cx(current && "hidden @min-[54rem]:inline")}>
          {current ? t(toolLabel[current]) : t("tool.more")}
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>
      <Presence show={open} kind="float">
        <Popover padding="menu" role="menu" className="absolute top-11 left-0 w-56">
          {tools.map((id) => (
            <MenuItem
              key={id}
              icon={toolIcons[id]}
              onClick={() => {
                setTool(id);
                setOpen(false);
              }}
            >
              <span className="flex-1">{t(toolLabel[id])}</span>
              <span className="font-num text-[11px] text-faint">{toolKey(id)}</span>
            </MenuItem>
          ))}
        </Popover>
      </Presence>
    </div>
  );
}
