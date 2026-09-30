import type { BridgeType } from "@/geometry/bridges";
import { bridgeSurchargeOf } from "@/geometry/energy";
import type { EnergySummary } from "@/geometry/energy";
import { factorSetOf } from "@/geometry/heating";
import type { Building, FactorSet } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { CustomReadOnly } from "@/components/shared/CustomField";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { Presence } from "@/components/shared/Presence";

const bridgeTypeKey: Record<BridgeType, MessageKey> = {
  corner: "bridges.type.corner",
  opening: "bridges.type.opening",
  slabEdge: "bridges.type.slabEdge",
  roofEdge: "bridges.type.roofEdge",
  floorJoint: "bridges.type.floorJoint",
  junction: "bridges.type.junction",
};

/** The flat surcharges a certificate may use, DIN V 18599-2 and GEG §24. */
const SURCHARGES: readonly { value: string; label: MessageKey }[] = [
  { value: "0.1", label: "bridges.surcharge.standard" },
  { value: "0.05", label: "bridges.surcharge.a" },
  { value: "0.03", label: "bridges.surcharge.b" },
  { value: "0.15", label: "bridges.surcharge.inside" },
];

/**
 * How the balance is counted: thermal bridges as a flat surcharge or detailed, and which
 * primary energy factors apply. Read only while a scenario is on show.
 */
export function MethodSection({
  building,
  summary,
  disabled,
}: {
  building: Building;
  summary: EnergySummary;
  disabled: boolean;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const setEnergyMethod = useEditorStore((s) => s.setEnergyMethod);
  const setBridgeDetail = useEditorStore((s) => s.setBridgeDetail);
  const method = building.bridgeMethod ?? "flat";
  const surcharge = String(bridgeSurchargeOf(building));
  const types = (Object.keys(summary.bridges.lengths) as BridgeType[]).filter(
    (k) => summary.bridges.lengths[k] > 0,
  );
  const num = (v: number, d = 1) => formatNumber(v, language, d);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs font-medium text-muted">{t("method.title")}</span>
      <CustomSelect<FactorSet>
        label={t("method.factors")}
        value={factorSetOf(building)}
        disabled={disabled}
        options={[
          { value: "geg2024", label: t("factors.geg2024") },
          { value: "gmodg2027", label: t("factors.gmodg2027") },
        ]}
        onChange={(factorSet) => {
          setEnergyMethod({ factorSet });
        }}
      />
      <CustomSegmented
        label={`${t("bridges.title")}: ${t("bridges.method")}`}
        value={method}
        disabled={disabled}
        options={[
          { value: "flat", label: t("bridges.flat") },
          { value: "detailed", label: t("bridges.detailed") },
        ]}
        onChange={(bridgeMethod) => {
          setEnergyMethod({ bridgeMethod });
        }}
      />
      <Presence show={method === "flat"}>
        <CustomSelect
          label={t("bridges.surcharge")}
          value={SURCHARGES.some((s) => s.value === surcharge) ? surcharge : "0.1"}
          disabled={disabled}
          options={SURCHARGES.map((s) => ({ value: s.value, label: t(s.label) }))}
          onChange={(value) => {
            setEnergyMethod({ bridgeSurcharge: Number(value) });
          }}
        />
      </Presence>
      <Presence show={method === "detailed"} className="flex flex-col gap-2">
        <CustomSegmented
          label={t("bridges.detail")}
          value={building.bridgeDetail ?? "poor"}
          disabled={disabled}
          options={[
            { value: "poor", label: t("bridges.poor") },
            { value: "good", label: t("bridges.good") },
          ]}
          onChange={setBridgeDetail}
        />
        {types.map((k) => (
          <CustomReadOnly
            key={k}
            label={t(bridgeTypeKey[k])}
            value={`${num(summary.bridges.lengths[k])} m · ${num(summary.bridges.losses[k])} W/K`}
          />
        ))}
      </Presence>
      <CustomReadOnly label={t("bridges.loss")} value={`${num(summary.bridgeLoss)} W/K`} />
    </div>
  );
}
