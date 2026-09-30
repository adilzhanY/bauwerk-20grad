import { Card } from "@/components/shared/Card";
import { useT } from "@/i18n/useT";
import { EnergyPanel } from "@/components/editor/EnergyPanel";
import { ScenariosPanel } from "@/components/editor/ScenariosPanel";

/**
 * A project's Variants step: the renovation variants with their costs and subsidy beside the
 * energy balance of the variant on show. The calculations a consultant does after the survey,
 * with room to read them, instead of in the editor's side panel.
 */
export function VariantsPage() {
  const t = useT();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1400px] grid-cols-2 items-start gap-5 px-8 pt-6 pb-16">
        <Card as="section" aria-label={t("project.step.variants")} className="p-5">
          <h2 className="mb-4 text-lg font-semibold">{t("scenarios.title")}</h2>
          <ScenariosPanel />
        </Card>
        <Card as="section" aria-label={t("energy.title")} className="p-5">
          <h2 className="mb-4 text-lg font-semibold">{t("energy.title")}</h2>
          <EnergyPanel />
        </Card>
      </div>
    </div>
  );
}
