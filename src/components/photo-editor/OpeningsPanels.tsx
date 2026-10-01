import { useFormat } from "@/lod2/format";
import { type Opening, type OpeningsSummary, openingArea } from "lod2-core/openings";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useT } from "@/i18n/useT";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomReadOnly, CustomSection } from "@/components/shared/CustomField";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { cx } from "@/components/shared/cx";
import { Hint } from "@/components/shared/Hint";
import { OPENING_FIELD_MAX_M } from "@/components/photo-editor/constants";

/** Buttons and edit fields for the openings: a floating pill above the wall image. */
export function OpeningsToolbar({
  selected,
  onNew,
  onDuplicate,
  onDelete,
  onChange,
}: {
  selected: Opening | null;
  onNew: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** `field` names the number field typed in, so typing one value is one undo step. */
  onChange: (next: Opening, field?: string) => void;
}) {
  const t = useT();
  const { language } = useFormat();
  const field = (label: string, key: "x" | "y" | "width" | "height") => (
    <div className="w-24">
      <CustomNumberInput
        label={label}
        value={selected ? selected[key] : 0}
        min={0}
        max={OPENING_FIELD_MAX_M}
        step={0.01}
        unit="m"
        slider={false}
        language={language}
        disabled={!selected}
        onChange={(value) => {
          if (!selected) return;
          onChange({ ...selected, [key]: value }, key);
        }}
      />
    </div>
  );

  return (
    <div className="flex shrink-0 flex-col items-center pb-3">
      <div className="flex max-w-full flex-wrap items-end gap-3 rounded-control border border-line bg-paper px-5 py-2.5 shadow-float">
        <div className="flex items-center gap-1.5 self-center">
          <CustomButton icon={<Plus size={15} aria-hidden />} onClick={onNew}>
            {t("photo.new")}
          </CustomButton>
          <CustomButton
            icon={<Copy size={15} aria-hidden />}
            onClick={onDuplicate}
            disabled={!selected}
          >
            {t("photo.duplicate")}
          </CustomButton>
          <CustomButton
            variant="danger"
            icon={<Trash2 size={15} aria-hidden />}
            onClick={onDelete}
            disabled={!selected}
          >
            {t("photo.delete")}
          </CustomButton>
        </div>
        <span aria-hidden className="mx-1 h-8 w-px self-center bg-line" />
        {/* The four numbers and the kind stay one group: when the bar wraps, it wraps
            before them, never between X and Height. */}
        <div className="flex items-end gap-3">
          {field("X", "x")}
          {field("Y", "y")}
          {field(t("photo.width"), "width")}
          {field(t("photo.height"), "height")}
          <div className="w-44">
            <CustomSegmented
              label={t("photo.kind")}
              value={selected?.kind ?? "window"}
              disabled={!selected}
              options={[
                { value: "window", label: t("photo.window") },
                { value: "door", label: t("photo.door") },
              ]}
              onChange={(kind) => {
                if (selected) onChange({ ...selected, kind });
              }}
            />
          </div>
        </div>
      </div>
      <Hint className="mt-1.5">{t("photo.fieldsHint")}</Hint>
    </div>
  );
}

/** The per-wall numbers, shown under the rectified wall. */
export function SummaryStrip({ summary }: { summary: OpeningsSummary }) {
  const t = useT();
  const format = useFormat();
  const ratio = format.ratio(summary.ratio);
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-6 gap-y-1 px-4 pt-3 text-xs text-muted">
      <span>
        {t("photo.openings")} <b className="font-num font-semibold text-ink">{summary.count}</b>
      </span>
      <span>
        {t("photo.openingArea")}{" "}
        <b className="font-num font-semibold text-ink">{format.area(summary.openingArea)}</b>
      </span>
      <span>
        {t("photo.wallArea")}{" "}
        <b className="font-num font-semibold text-ink">{format.area(summary.wallArea)}</b>
      </span>
      <span>
        {t("photo.ratio")} <b className="font-num font-semibold text-ink">{ratio}</b>
      </span>
    </div>
  );
}

/** The list of openings with their areas, for the side column. */
export function OpeningsList({
  openings,
  selected,
  summary,
  onSelect,
}: {
  openings: Opening[];
  selected: number | null;
  summary: OpeningsSummary;
  onSelect: (index: number) => void;
}) {
  const t = useT();
  const format = useFormat();
  const ratio = format.ratio(summary.ratio);
  const detected = openings.some((o) => o.score !== undefined);
  return (
    <CustomSection title={t("photo.openings")}>
      {openings.length === 0 ? (
        <Hint>{t("photo.noneYet")}</Hint>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="px-1 pb-1 text-left font-medium">#</th>
              <th className="px-1 pb-1 text-right font-medium">{t("photo.width")}</th>
              <th className="px-1 pb-1 text-right font-medium">{t("photo.height")}</th>
              <th className="px-1 pb-1 text-right font-medium">{t("photo.area")}</th>
              {detected && (
                <th className="px-1 pb-1 text-right font-medium">{t("photo.confidence")}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {openings.map((o, index) => (
              // The number's button covers the whole row: a click anywhere picks the opening,
              // and the keyboard reaches it.
              <tr
                key={index}
                className={cx(
                  "relative font-num text-ink transition-colors hover:bg-select-soft",
                  index === selected && "bg-select-soft",
                )}
              >
                <td className="px-1 py-1.5 text-left">
                  <button
                    type="button"
                    aria-label={t("photo.openingN", { n: index + 1 })}
                    aria-pressed={index === selected}
                    onClick={() => {
                      onSelect(index);
                    }}
                    className="after:absolute after:inset-0"
                  >
                    {index + 1}
                  </button>
                </td>
                <td className="px-1 py-1.5 text-right">{format.num(o.width, 2)} m</td>
                <td className="px-1 py-1.5 text-right">{format.num(o.height, 2)} m</td>
                <td className="px-1 py-1.5 text-right">{format.area(openingArea(o))}</td>
                {detected && (
                  <td className="px-1 py-1.5 text-right">
                    {o.score === undefined ? (
                      "-"
                    ) : (
                      <span
                        className={cx(
                          "inline-block rounded-soft border px-1.5 py-px text-[11px] leading-4",
                          o.score < 0.7 ? "border-mark text-mark" : "border-line text-muted",
                        )}
                      >
                        {Math.round(o.score * 100)} %
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-col gap-2">
        <CustomReadOnly
          label={t("photo.totalOpeningArea")}
          value={format.area(summary.openingArea)}
        />
        <CustomReadOnly label={t("photo.wallArea")} value={format.area(summary.wallArea)} />
        <CustomReadOnly label={t("photo.ratio")} value={ratio} />
      </div>
    </CustomSection>
  );
}
