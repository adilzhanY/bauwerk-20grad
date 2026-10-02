import { Card } from "@/components/shared/Card";
import { useT } from "@/i18n/useT";
import { EnergyInputs, EnergyResults } from "@/components/editor/EnergyPanel";
import { ScenariosPanel } from "@/components/editor/ScenariosPanel";

/** Scenarios and result stay in sight while the page scrolls; this much is kept clear above and below. */
const IN_SIGHT = "lg:sticky lg:top-5 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto";

/**
 * A project's Variants step, everything at a glance: the renovation scenarios, the inputs of
 * the energy balance, and its result. The result stays in place and follows every input at
 * once, so a change is seen without scrolling back up.
 *
 * From 1024 px (laptops, monitors, a tablet held across) three columns: scenarios on the left,
 * inputs in the middle, the result on the right. A laptop's window is 1280 to 1440 px, which
 * the first version gave only two. From 768 px (a tablet held upright) three would be too
 * narrow for the fields: the scenarios sit above the inputs and the result keeps its own
 * column. Below that, one column.
 */
export function VariantsPage() {
  const t = useT();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1800px] grid-cols-1 items-start gap-4 px-4 pt-5 pb-16 md:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] md:px-6 lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.1fr)_minmax(300px,340px)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(340px,400px)] xl:gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(360px,440px)]">
        <Card
          as="section"
          aria-label={t("scenarios.title")}
          className={`p-5 md:col-start-1 md:row-start-1 ${IN_SIGHT}`}
        >
          <h2 className="mb-4 text-lg font-semibold">{t("scenarios.title")}</h2>
          <ScenariosPanel />
        </Card>
        <Card
          as="section"
          aria-label={t("energy.inputs")}
          className="p-5 md:col-start-1 md:row-start-2 lg:col-start-2 lg:row-start-1"
        >
          <h2 className="mb-4 text-lg font-semibold">{t("energy.inputs")}</h2>
          <EnergyInputs />
        </Card>
        <Card
          as="section"
          aria-label={t("energy.title")}
          // Stays in sight while the page scrolls, and scrolls itself when taller than the window.
          className="p-5 md:sticky md:top-5 md:col-start-2 md:row-span-2 md:row-start-1 md:max-h-[calc(100dvh-9rem)] md:overflow-y-auto lg:col-start-3 lg:row-span-1"
        >
          <h2 className="mb-4 text-lg font-semibold">{t("energy.title")}</h2>
          <EnergyResults />
        </Card>
      </div>
    </div>
  );
}
