import { Box, Plus } from "lucide-react";
import { useState } from "react";
import { NewBuildingDialog } from "@/components/editor/NewBuildingDialog";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { Centered } from "@/components/shared/Centered";
import { CustomButton } from "@/components/shared/CustomButton";
import { Presence } from "@/components/shared/Presence";

/** The editor without a storey: add one, or make a whole building at once. */
export function EmptyState() {
  const t = useT();
  const addStorey = useEditorStore((s) => s.addStorey);
  const [open, setOpen] = useState(false);
  return (
    <Centered title={t("empty.title")} body={t("empty.body")}>
      <div className="flex gap-2">
        <CustomButton variant="primary" icon={<Plus size={14} />} onClick={addStorey}>
          {t("storey.add")}
        </CustomButton>
        <CustomButton
          variant="quiet"
          icon={<Box size={14} />}
          onClick={() => {
            setOpen(true);
          }}
        >
          {t("newBuilding.title")}
        </CustomButton>
      </div>
      <Presence show={open} kind="float">
        <NewBuildingDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      </Presence>
    </Centered>
  );
}
