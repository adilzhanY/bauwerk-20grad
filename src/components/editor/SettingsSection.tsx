import { CustomSection } from "@/components/shared/CustomField";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { useT } from "@/i18n/useT";
import { example } from "@/lib/examples";
import type { ExampleId } from "@/lib/examples";
import { startNewProject } from "@/projects/session";
import { useEditorStore } from "@/store/building";

/**
 * The example buildings, for demos and the bench. The survey panel shows this only with ?dev
 * in the address (`devMode`); language and theme sit in the top bar, the building's own
 * settings in its properties.
 */
export function SettingsSection() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  return (
    <CustomSection title={t("panel.settings")}>
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
          if (id !== "") void startNewProject(example(id, language));
        }}
      />
    </CustomSection>
  );
}
