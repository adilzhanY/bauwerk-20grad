import { Presence } from "@/components/shared/Presence";
import { Box, Plus } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { NewBuildingDialog } from "@/components/editor/NewBuildingDialog";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";

function Centered({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-paper p-8 text-center">
      <h1 className="font-display text-title font-semibold text-ink">{title}</h1>
      <p className="max-w-md text-base text-muted">{body}</p>
      {children}
    </div>
  );
}

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

export function WebGLMissing() {
  const t = useT();
  return <Centered title={t("webgl.title")} body={t("webgl.body")} />;
}

export function TooNarrow() {
  const t = useT();
  return <Centered title={t("narrow.title")} body={t("narrow.body")} />;
}
