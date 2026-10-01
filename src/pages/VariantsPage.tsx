import { Card } from "@/components/shared/Card";
import { useT } from "@/i18n/useT";
import { EnergyInputs, EnergyResults } from "@/components/editor/EnergyPanel";
import { ScenariosPanel } from "@/components/editor/ScenariosPanel";

/**
 * A project's Variants step, everything at a glance: the renovation scenarios, the inputs of
 * the energy balance, and its result. The result stays in place and follows every input at
 * once, so a change is seen without scrolling back up. From 1536 px three columns (scenarios,
 * inputs, result); below that the scenarios sit above the inputs and the result keeps its own
 * column on the right.
 */
export function VariantsPage() {
  const t = useT();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1800px] grid-cols-[minmax(0,1fr)_minmax(340px,420px)] items-start gap-5 px-6 pt-5 pb-16 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(360px,440px)]">
        <Card
          as="section"
          aria-label={t("scenarios.title")}
          // From 1536 px it stays in sight like the result; below, it scrolls with the inputs.
          className="p-5 2xl:sticky 2xl:top-5 2xl:col-start-1 2xl:row-start-1 2xl:max-h-[calc(100dvh-9rem)] 2xl:overflow-y-auto"
        >
          <h2 className="mb-4 text-lg font-semibold">{t("scenarios.title")}</h2>
          <ScenariosPanel />
        </Card>
        <Card
          as="section"
          aria-label={t("energy.inputs")}
          className="col-start-1 row-start-2 p-5 2xl:col-start-2 2xl:row-start-1"
        >
          <h2 className="mb-4 text-lg font-semibold">{t("energy.inputs")}</h2>
          <EnergyInputs />
        </Card>
        <Card
          as="section"
          aria-label={t("energy.title")}
          // Stays in sight while the page scrolls, and scrolls itself when taller than the window.
          className="sticky top-5 col-start-2 row-span-2 row-start-1 max-h-[calc(100dvh-9rem)] overflow-y-auto p-5 2xl:col-start-3 2xl:row-span-1"
        >
          <h2 className="mb-4 text-lg font-semibold">{t("energy.title")}</h2>
          <EnergyResults />
        </Card>
      </div>
    </div>
  );
}
