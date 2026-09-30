import { CustomFieldGroup } from "@/components/shared/CustomField";
import { Hint } from "@/components/shared/Hint";
import { useState } from "react";
import { centroid } from "@/geometry/polygon";
import type { Roof } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { BOX_LIMITS, buildingFromBox } from "@/geometry/box";
import type { Era } from "@/geometry/box";
import { createId } from "@/lib/ids";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomTextInput } from "@/components/shared/CustomTextInput";

/** Width, depth, storeys, height, roof and era: a whole building in one step. */
export function NewBuildingDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const currentBuilding = useEditorStore((s) => s.building);
  const loadBuilding = useEditorStore((s) => s.loadBuilding);
  const [name, setName] = useState(t("newBuilding.defaultName"));
  const [width, setWidth] = useState(12);
  const [depth, setDepth] = useState(9);
  const [storeys, setStoreys] = useState(2);
  const [storeyHeight, setStoreyHeight] = useState(2.8);
  const [roof, setRoof] = useState<Roof["kind"]>("gable");
  const [era, setEra] = useState<Era>("1970s");

  const create = () => {
    loadBuilding(
      buildingFromBox(
        {
          name,
          width,
          depth,
          storeys,
          storeyHeight,
          roof,
          era,
          centre: centroid(currentBuilding.footprint),
          origin: currentBuilding.origin,
        },
        language,
        createId,
      ),
    );
    onClose();
  };

  return (
    <CustomDialog title={t("newBuilding.title")} closeLabel={t("common.cancel")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <CustomTextInput label={t("building.name")} value={name} onCommit={setName} />
        <div className="grid grid-cols-2 gap-3">
          <CustomNumberInput
            label={t("building.width")}
            value={width}
            min={BOX_LIMITS.width.min}
            max={BOX_LIMITS.width.max}
            step={0.5}
            unit={t("common.metres")}
            language={language}
            onChange={setWidth}
          />
          <CustomNumberInput
            label={t("building.depth")}
            value={depth}
            min={BOX_LIMITS.depth.min}
            max={BOX_LIMITS.depth.max}
            step={0.5}
            unit={t("common.metres")}
            language={language}
            onChange={setDepth}
          />
          <CustomNumberInput
            label={t("status.storeys")}
            value={storeys}
            min={BOX_LIMITS.storeys.min}
            max={BOX_LIMITS.storeys.max}
            step={1}
            language={language}
            onChange={(v) => {
              setStoreys(Math.round(v));
            }}
          />
          <CustomNumberInput
            label={t("storey.height")}
            value={storeyHeight}
            min={BOX_LIMITS.storeyHeight.min}
            max={BOX_LIMITS.storeyHeight.max}
            step={0.1}
            unit={t("common.metres")}
            language={language}
            onChange={setStoreyHeight}
          />
        </div>
        <CustomFieldGroup label={t("roof.kind")}>
          <CustomSegmented
            label={t("roof.kind")}
            value={roof}
            options={[
              { value: "flat", label: t("roof.flat") },
              { value: "gable", label: t("roof.gable") },
              { value: "hip", label: t("roof.hip") },
            ]}
            onChange={setRoof}
          />
        </CustomFieldGroup>
        <CustomFieldGroup label={t("newBuilding.era")}>
          <CustomSegmented
            label={t("newBuilding.era")}
            value={era}
            options={[
              { value: "pre1918", label: t("newBuilding.era.pre1918") },
              { value: "1970s", label: t("newBuilding.era.1970s") },
              { value: "insulated", label: t("newBuilding.era.insulated") },
            ]}
            onChange={setEra}
          />
        </CustomFieldGroup>
        <Hint>{t("newBuilding.hint")}</Hint>
        <div className="flex justify-end gap-2 pt-1">
          <CustomButton variant="quiet" onClick={onClose}>
            {t("common.cancel")}
          </CustomButton>
          <CustomButton variant="primary" onClick={create}>
            {t("newBuilding.create")}
          </CustomButton>
        </div>
      </div>
    </CustomDialog>
  );
}
