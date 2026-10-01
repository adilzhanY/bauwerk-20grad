import { Presence } from "@/components/shared/Presence";
import { CustomFieldGroup } from "@/components/shared/CustomField";
import { useT } from "@/i18n/useT";
import { example } from "@/lib/examples";
import type { ExampleId } from "@/lib/examples";
import { startNewProject } from "@/projects/session";
import { useEditorStore } from "@/store/building";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { CustomSlider } from "@/components/shared/CustomSlider";
import { CustomField, CustomSection } from "@/components/shared/CustomField";
import { formatNumber } from "@/lib/format";
import { useShallow } from "zustand/react/shallow";

/** How the storeys that are not being edited are drawn: above, below, the roof. */
export function OtherStoreysControls() {
  const t = useT();
  const { o, language, setOtherStoreys } = useEditorStore(
    useShallow((s) => ({
      o: s.otherStoreys,
      language: s.language,
      setOtherStoreys: s.setOtherStoreys,
    })),
  );
  const showOpacity = o.above === "ghost" || o.below === "ghost" || o.roof === "ghost";
  return (
    <div className="flex flex-col gap-3">
      <CustomFieldGroup label={t("view.storeysAbove")}>
        <CustomSegmented
          label={t("view.storeysAbove")}
          value={o.above}
          options={[
            { value: "hidden", label: t("view.storeysHidden") },
            { value: "outline", label: t("view.storeysOutline") },
            { value: "ghost", label: t("view.storeysGhost") },
          ]}
          onChange={(above) => {
            setOtherStoreys({ above });
          }}
        />
      </CustomFieldGroup>
      <CustomFieldGroup label={t("view.storeysBelow")}>
        <CustomSegmented
          label={t("view.storeysBelow")}
          value={o.below}
          options={[
            { value: "outline", label: t("view.storeysOutline") },
            { value: "ghost", label: t("view.storeysGhost") },
            { value: "solid", label: t("view.storeysSolid") },
          ]}
          onChange={(below) => {
            setOtherStoreys({ below });
          }}
        />
      </CustomFieldGroup>
      <CustomFieldGroup label={t("view.roofDisplay")}>
        <CustomSegmented
          label={t("view.roofDisplay")}
          value={o.roof}
          options={[
            { value: "hidden", label: t("view.storeysHidden") },
            { value: "outline", label: t("view.storeysOutline") },
            { value: "ghost", label: t("view.storeysGhost") },
            { value: "solid", label: t("view.storeysSolid") },
          ]}
          onChange={(roof) => {
            setOtherStoreys({ roof });
          }}
        />
      </CustomFieldGroup>
      <Presence show={showOpacity}>
        <CustomField
          label={`${t("view.ghostOpacity")}: ${formatNumber(Math.round(o.ghostOpacity * 100), language)} %`}
        >
          <CustomSlider
            label={t("view.ghostOpacity")}
            value={Math.round(o.ghostOpacity * 100)}
            min={5}
            max={60}
            step={5}
            onChange={(pct) => {
              setOtherStoreys({ ghostOpacity: pct / 100 });
            }}
            format={(pct) => `${formatNumber(pct, language)} %`}
          />
        </CustomField>
      </Presence>
    </div>
  );
}

/**
 * The editor's settings. `examples` offers the example buildings, which are for demos and the
 * bench: the editor passes it only with ?dev in the address (`devMode`).
 */
export function SettingsSection({ examples = true }: { examples?: boolean } = {}) {
  const t = useT();
  const s = useEditorStore(
    useShallow((state) => ({
      language: state.language,
    })),
  );

  return (
    <>
      <CustomSection title={t("panel.settings")}>
        {examples && (
          <CustomSelect<ExampleId | "">
            label={t("settings.example")}
            value=""
            options={[
              { value: "", label: t("settings.examplePlaceholder") },
              { value: "altbau", label: t("example.altbau") },
              { value: "tower", label: t("example.tower") },
              { value: "house", label: t("example.house") },
              { value: "block", label: t("example.block") },
            ]}
            onChange={(id) => {
              if (id !== "") void startNewProject(example(id, s.language));
            }}
          />
        )}
      </CustomSection>
      <CustomSection title={t("panel.otherStoreys")}>
        <OtherStoreysControls />
      </CustomSection>
    </>
  );
}
