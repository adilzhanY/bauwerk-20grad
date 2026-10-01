import { useState } from "react";
import { Keyboard } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { Floating } from "@/components/shared/Floating";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { Presence } from "@/components/shared/Presence";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { ShortcutSheet } from "./ShortcutSheet";
import { toolHint } from "./tools";

/**
 * The status line at the foot of the 3D view, where the eye already is: what the active tool
 * does, the keyboard shortcuts, and the map's credit while the map is on.
 */
export function StatusLine() {
  const t = useT();
  const tool = useEditorStore((s) => s.tool);
  const mapVisible = useEditorStore((s) => s.showMap && s.building.origin !== undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <Card
      elevation="float"
      className="pointer-events-auto flex min-h-11 items-center gap-3 py-1 pr-1 pl-4"
    >
      <p role="status" className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
        {t(toolHint[tool])}
      </p>
      <Presence show={mapVisible} kind="float">
        <Floating fade className="shrink-0">
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted hover:text-ink"
          >
            {t("map.attribution")}
          </a>
        </Floating>
      </Presence>
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
