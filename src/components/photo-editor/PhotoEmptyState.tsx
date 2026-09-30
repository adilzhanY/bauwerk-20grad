import { Presence } from "@/components/shared/Presence";
import { Spinner } from "@/components/shared/Spinner";
import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { useT } from "@/i18n/useT";
import { CustomButton } from "@/components/shared/CustomButton";
import { cx } from "@/components/shared/cx";
import { samplesFor } from "@/components/photo-editor/samples";
import type { SamplePhoto } from "@/components/photo-editor/samples";

/**
 * What the stage shows before there is a photo: the way to choose one, the hint that a
 * copied image can be pasted, and sample photos for someone without one at hand.
 */
export function PhotoEmptyState({
  error,
  buildingGid,
  onChoose,
  onSample,
}: {
  /** Why the last photo did not open, if it did not. */
  error: string | null;
  /** The building the editor is open for, so its own sample comes first. */
  buildingGid: string | null;
  onChoose: () => void;
  /** Opens a sample; rejects when it could not be loaded. */
  onSample: (sample: SamplePhoto) => Promise<void>;
}) {
  const t = useT();
  const [loading, setLoading] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState(false);
  const samples = samplesFor(buildingGid);

  const open = (sample: SamplePhoto) => {
    setLoading(sample.id);
    setSampleError(false);
    onSample(sample)
      .catch(() => {
        setSampleError(true);
      })
      .finally(() => {
        setLoading(null);
      });
  };

  return (
    <div className="photo-editor-stage overflow-y-auto">
      <div className="m-auto flex max-w-xl flex-col items-center gap-4 px-6 py-8 text-center">
        <span
          aria-hidden
          className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white/80"
        >
          <ImagePlus size={28} strokeWidth={1.6} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-lg font-semibold text-white">{t("photo.empty.title")}</h3>
          <p className="text-sm text-white/70">{t("photo.empty.body")}</p>
        </div>
        <CustomButton
          variant="primary"
          icon={<ImagePlus size={15} aria-hidden />}
          onClick={onChoose}
        >
          {t("photo.choosePhoto")}
        </CustomButton>
        <p className="text-xs text-white/60">
          {t("photo.empty.paste")}{" "}
          <kbd className="rounded-soft border border-white/25 px-1.5 py-0.5 font-num text-[11px] text-white/80">
            Ctrl+V
          </kbd>
        </p>
        <Presence value={error}>{(error) => <p className="text-sm text-mark">{error}</p>}</Presence>

        <Presence show={samples.length > 0}>
          <div className="mt-4 flex w-full flex-col items-center gap-3 border-t border-white/10 pt-6">
            <p className="text-sm text-white/70">{t("photo.sample.title")}</p>
            <ul className="flex flex-wrap justify-center gap-3">
              {samples.map((sample) => {
                const own = sample.gid === buildingGid;
                const busy = loading === sample.id;
                return (
                  <li key={sample.id}>
                    <button
                      type="button"
                      disabled={loading !== null}
                      aria-busy={busy || undefined}
                      onClick={() => {
                        open(sample);
                      }}
                      className={cx(
                        "group flex w-32 flex-col gap-1.5 rounded-control p-1.5 text-left transition-colors",
                        "hover:bg-white/10 disabled:cursor-wait",
                        loading !== null && !busy && "opacity-50",
                      )}
                    >
                      <span className="relative block h-36 w-full overflow-hidden rounded-soft bg-white/5">
                        <img
                          src={sample.thumb}
                          alt=""
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                        {busy && (
                          <span className="absolute inset-0 flex items-center justify-center bg-night/60">
                            <Spinner size="md" className="text-white" />
                          </span>
                        )}
                        {own && (
                          <span className="absolute top-1.5 left-1.5 rounded-soft bg-select px-1.5 py-0.5 text-[11px] font-medium text-white">
                            {t("photo.sample.own")}
                          </span>
                        )}
                      </span>
                      <span className="text-xs leading-snug text-white/80">
                        {t(sample.caption)}
                      </span>
                      <span className="font-num text-[11px] text-white/45">{sample.gid}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Presence show={sampleError}>
              <p className="text-sm text-mark">{t("photo.sample.failed")}</p>
            </Presence>
          </div>
        </Presence>
      </div>
    </div>
  );
}
