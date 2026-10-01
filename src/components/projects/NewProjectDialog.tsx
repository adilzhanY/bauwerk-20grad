import { Presence } from "@/components/shared/Presence";
import { useEffect, useRef, useState } from "react";
import { FileImage, MapPin, PencilRuler, Search } from "lucide-react";
import { readExifSummary } from "lod2-core/exif";
import { useRouter } from "@/app/router";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { CustomFormInput } from "@/components/shared/CustomFormInput";
import { cx } from "@/components/shared/cx";
import { createDefaultBuilding, useEditorStore } from "@/store/building";
import { useT } from "@/i18n/useT";
import { buildingAtPoint, searchAddress } from "@/lod2/api/geocode";
import type { Place } from "@/lod2/api/geocode";
import { useStore } from "@/lod2/state/store";
import { confirmLeave, startProject } from "@/projects/session";
import { withProject } from "@/projects/projects";
import { newProjectQuery } from "@/app/projectRoutes";

type Way = "address" | "map" | "files";

/** How often and how long to look for the building at an address while the API loads it. */
const TRIES = 4;
const TRY_MS = 1500;
const DEBOUNCE_MS = 250;

/**
 * A new project in one dialog. Three ways to the building: an address, a click on the map, or
 * photos whose GPS position finds it. Name and client are optional. The building page then
 * creates the project (see routes.ts); a building drawn by hand starts in the editor.
 */
export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useRouter((s) => s.navigate);
  const setView = useStore((s) => s.setView);
  const [way, setWay] = useState<Way>("address");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || place?.main === q) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchAddress(q, controller.signal)
        .then(setPlaces)
        .catch(() => {
          if (!controller.signal.aborted) setPlaces([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, place]);

  const request = { name, client };

  /** Finds the building at `at` and opens its page, which then creates the project. */
  const openAt = async (at: { lon: number; lat: number }) => {
    setBusy(true);
    setProblem(null);
    try {
      for (let i = 0; i < TRIES; i++) {
        const gid = await buildingAtPoint(at.lon, at.lat);
        if (gid) {
          onClose();
          navigate({ page: "building", gid }, { query: newProjectQuery(request) });
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, TRY_MS));
      }
      // Not loaded yet in this part of the city: the map loads it, the user picks it there.
      setView({ lon: at.lon, lat: at.lat, zoom: 18 });
      onClose();
      navigate({ page: "map" }, { query: newProjectQuery(request) });
    } catch {
      setProblem(t("newProject.error"));
    } finally {
      setBusy(false);
    }
  };

  const fromPhotos = async (files: FileList | null) => {
    const photo = files?.[0];
    if (!photo) return;
    const exif = readExifSummary(new Uint8Array(await photo.arrayBuffer()));
    if (exif?.latitude == null || exif.longitude == null) {
      setProblem(t("newProject.noGps"));
      return;
    }
    await openAt({ lon: exif.longitude, lat: exif.latitude });
  };

  /** A building drawn by hand: a new, empty project, straight into the editor. */
  const byHand = async () => {
    setBusy(true);
    const blank = createDefaultBuilding(useEditorStore.getState().language);
    const building = withProject(
      { ...blank, name: name.trim() || blank.name },
      client.trim() ? { client: client.trim() } : {},
    );
    setBusy(false);
    if (!(await confirmLeave())) return;
    startProject(building);
    onClose();
    navigate({ page: "editor" });
  };

  const create = () => {
    if (way === "map") {
      onClose();
      navigate({ page: "map" }, { query: newProjectQuery(request) });
    } else if (way === "address" && place) void openAt(place);
    else if (way === "files") fileInput.current?.click();
  };

  const ways: { id: Way; icon: React.ReactNode; title: string; text: string }[] = [
    {
      id: "address",
      icon: <Search size={18} aria-hidden />,
      title: t("newProject.address"),
      text: t("newProject.addressText"),
    },
    {
      id: "map",
      icon: <MapPin size={18} aria-hidden />,
      title: t("newProject.map"),
      text: t("newProject.mapText"),
    },
    {
      id: "files",
      icon: <FileImage size={18} aria-hidden />,
      title: t("newProject.files"),
      text: t("newProject.filesText"),
    },
  ];

  return (
    <CustomDialog
      title={t("newProject.title")}
      closeLabel={t("common.close")}
      onClose={onClose}
      width={760}
    >
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label={t("newProject.how")} className="grid grid-cols-3 gap-3">
          {ways.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={way === w.id}
              onClick={() => {
                setWay(w.id);
                setProblem(null);
              }}
              className={cx(
                "flex min-w-0 flex-col gap-1.5 rounded-card border p-4 text-left transition-colors",
                way === w.id
                  ? "border-select bg-select-soft/40 ring-2 ring-select-soft"
                  : "border-line hover:bg-panel",
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-control bg-select-soft text-select">
                {w.icon}
              </span>
              <span className="text-sm font-semibold text-ink">{w.title}</span>
              <span className="text-xs leading-relaxed text-muted">{w.text}</span>
            </button>
          ))}
        </div>

        <Presence show={way === "address"}>
          <div className="flex flex-col gap-1.5">
            <CustomFormInput
              label={t("newProject.addressLabel")}
              value={query}
              placeholder={t("newProject.addressExample")}
              // Once a suggestion is picked, the full address says which building it is.
              {...(place
                ? {
                    hint: t("newProject.found", {
                      address: [place.main, place.area].filter(Boolean).join(", "),
                    }),
                  }
                : {})}
              onChange={(v) => {
                setQuery(v);
                setPlace(null);
              }}
            />
            <Presence show={!place && places.length > 0}>
              <ul className="flex max-h-48 flex-col overflow-y-auto rounded-inner border border-line">
                {places.map((p) => (
                  <li key={`${p.main}|${p.area}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setPlace(p);
                        setQuery(p.main);
                        setPlaces([]);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel"
                    >
                      <MapPin size={14} aria-hidden className="shrink-0 text-muted" />
                      <b className="font-semibold text-ink">{p.main}</b>
                      {p.area && <span className="truncate text-muted">{p.area}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Presence>
          </div>
        </Presence>
        <Presence show={way === "files"}>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              void fromPhotos(e.dataTransfer.files);
            }}
            className="rounded-card border-2 border-dashed border-line-strong p-6 text-center text-sm text-muted hover:bg-panel"
          >
            {t("newProject.drop")}
          </button>
        </Presence>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/heic,image/*"
          className="hidden"
          onChange={(e) => {
            void fromPhotos(e.target.files);
          }}
        />

        <div className="grid grid-cols-2 gap-3">
          <CustomFormInput label={t("newProject.name")} value={name} onChange={setName} />
          <CustomFormInput label={t("newProject.client")} value={client} onChange={setClient} />
        </div>

        <Presence value={problem}>
          {(problem) => (
            <p role="alert" className="text-sm text-mark">
              {problem}
            </p>
          )}
        </Presence>

        <div className="flex items-center justify-between gap-2">
          <CustomButton
            variant="quiet"
            icon={<PencilRuler size={15} aria-hidden />}
            disabled={busy}
            onClick={() => {
              void byHand();
            }}
          >
            {t("newProject.byHand")}
          </CustomButton>
          <div className="flex gap-2">
            <CustomButton onClick={onClose}>{t("common.cancel")}</CustomButton>
            <CustomButton
              variant="primary"
              disabled={way === "address" && !place}
              loading={busy}
              onClick={create}
            >
              {way === "map"
                ? t("newProject.toMap")
                : way === "files"
                  ? t("newProject.choosePhoto")
                  : t("newProject.create")}
            </CustomButton>
          </div>
        </div>
      </div>
    </CustomDialog>
  );
}
