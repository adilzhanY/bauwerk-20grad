import { Line } from "./Line";
import { useEditorStore } from "@/store/building";
import { storeyElevation } from "@/store/selectors";
import { useSceneColors } from "./useSceneColors";

/** The detected footprint and walls drawn over the underlay in the selection colour until accepted. */
export function ProposalOverlay() {
  const proposal = useEditorStore((s) => s.proposal);
  const building = useEditorStore((s) => s.building);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const scene = useSceneColors();
  if (!proposal) return null;
  const y = (activeStoreyId ? storeyElevation(building, activeStoreyId) : 0) + 0.08;
  const ring = [...proposal.footprint, proposal.footprint[0]].filter(
    (p): p is NonNullable<typeof p> => p !== undefined,
  );
  return (
    <group>
      <Line
        points={ring.map((p) => [p.x, y, p.y] as [number, number, number])}
        color={scene.select}
        lineWidth={3}
      />
      {proposal.interiorWalls.map((w, i) => (
        <Line
          key={i}
          points={[
            [w.segment.a.x, y, w.segment.a.y],
            [w.segment.b.x, y, w.segment.b.y],
          ]}
          color={w.enabled ? scene.select : scene.muted}
          lineWidth={w.enabled ? 2.5 : 1}
          dashed={!w.enabled}
          dashSize={0.2}
          gapSize={0.15}
        />
      ))}
    </group>
  );
}
