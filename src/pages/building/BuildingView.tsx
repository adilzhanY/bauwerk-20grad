import { useState } from "react";
import { Box, Map as MapIcon } from "lucide-react";
import { useRouter } from "@/app/router";
import { cx } from "@/components/cx";
import { useT } from "@/i18n/useT";
import { Scene } from "@/lod2/render3d/Scene";
import { BuildingMap } from "../map/BuildingMap";

/**
 * The right side of the building page: the LoD2 model in 3D, where a click picks the wall to
 * photograph, or the map with the building marked. Two round buttons switch between them.
 */
export function BuildingView({ gid }: { gid: string }) {
  const t = useT();
  const navigate = useRouter((s) => s.navigate);
  const [mode, setMode] = useState<"3d" | "map">("3d");
  return (
    <div className="scene-ground relative h-full overflow-hidden">
      {mode === "3d" ? (
        <div className="absolute inset-0">
          <Scene />
        </div>
      ) : (
        <BuildingMap
          selectedGid={gid}
          onPick={(picked) => {
            if (picked !== gid) navigate({ page: "building", gid: picked });
          }}
        />
      )}
      <div className="absolute top-4 left-4 z-10 flex gap-1 rounded-card border border-line bg-paper p-1 shadow-float">
        <ViewButton
          label={t("building.view3d")}
          active={mode === "3d"}
          onClick={() => {
            setMode("3d");
          }}
        >
          <Box size={16} aria-hidden />
        </ViewButton>
        <ViewButton
          label={t("building.viewMap")}
          active={mode === "map"}
          onClick={() => {
            setMode("map");
          }}
        >
          <MapIcon size={16} aria-hidden />
        </ViewButton>
      </div>
    </div>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "flex h-9 items-center gap-1.5 rounded-control px-3 text-sm transition-colors",
        active
          ? "bg-select font-semibold text-white"
          : "font-medium text-muted hover:bg-panel hover:text-ink",
      )}
    >
      {children}
      {label}
    </button>
  );
}
