import { useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import { Line } from "./Line";
import { PSI, bridgeDetailOf, summarizeBridges } from "@/geometry/bridges";
import type { Bridge, BridgeType } from "@/geometry/bridges";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { useSceneColors } from "./useSceneColors";

const typeKey: Record<BridgeType, MessageKey> = {
  corner: "bridges.type.corner",
  opening: "bridges.type.opening",
  slabEdge: "bridges.type.slabEdge",
  roofEdge: "bridges.type.roofEdge",
  floorJoint: "bridges.type.floorJoint",
  junction: "bridges.type.junction",
};

/** Red lines on every linear thermal bridge, width by ψ·l, hover shows type and W/K. */
export function ThermalBridges() {
  const t = useT();
  const show = useEditorStore((s) => s.showBridges);
  const building = useEditorStore((s) => s.building);
  const language = useEditorStore((s) => s.language);
  const scene = useSceneColors();
  const [hovered, setHovered] = useState<Bridge | null>(null);
  const summary = useMemo(() => summarizeBridges(building, bridgeDetailOf(building)), [building]);
  if (!show) return null;
  const detail = bridgeDetailOf(building);
  const lift = 0.02;
  return (
    <group>
      {summary.bridges.map((b, i) => {
        const loss = PSI[detail][b.type] * b.length;
        const width = 1.5 + Math.min(4, loss / 4);
        return b.segments.map((s, j) => (
          <Line
            key={`${i}-${j}`}
            points={[
              [s.a.x, s.z0 + lift, s.a.y],
              [s.b.x, s.z1 + lift, s.b.y],
            ]}
            color={scene.mark}
            lineWidth={hovered === b ? width + 2 : width}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered(b);
            }}
            onPointerOut={() => {
              setHovered(null);
            }}
          />
        ));
      })}
      {hovered?.segments[0] && (
        <Html
          position={[
            hovered.segments[0].a.x,
            (hovered.segments[0].z0 + hovered.segments[0].z1) / 2 + 0.3,
            hovered.segments[0].a.y,
          ]}
          center
          style={{ pointerEvents: "none" }}
        >
          <span className="rounded-soft border border-mark bg-paper/95 px-2 py-0.5 text-xs whitespace-nowrap text-ink select-none">
            {t(typeKey[hovered.type])} · {formatNumber(hovered.length, language, 2)} m · ψ{" "}
            {formatNumber(PSI[detail][hovered.type], language, 2)} ·{" "}
            {formatNumber(PSI[detail][hovered.type] * hovered.length, language, 2)} W/K
          </span>
        </Html>
      )}
    </group>
  );
}
