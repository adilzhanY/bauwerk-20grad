import { useEffect, useRef, useState } from "react";
import { Building2, Loader2, MapPin, Search } from "lucide-react";
import { useRouter } from "@/app/router";
import { useT } from "@/i18n/useT";
import { search as searchGid } from "@/lod2/api/client";
import { buildingAtPoint, searchAddress } from "@/lod2/api/geocode";
import type { Place } from "@/lod2/api/geocode";
import { useStore } from "@/lod2/state/store";
import { BuildingMap } from "./map/BuildingMap";

/** Wait this long after the last key before asking the geocoder. */
const DEBOUNCE_MS = 250;
/** How often and how long to look for a building that the map is still loading. */
const RETRY_MS = 2000;
const RETRIES = 8;
/** A Gebäude-ID: state prefix and then letters and digits. */
const GID_PATTERN = /^DE[A-Z]{2}[A-Za-z0-9]{2,}$/;

type Hit = { kind: "place"; place: Place } | { kind: "building"; gid: string };

/**
 * The start page: type an address or a Gebäude-ID, or click a building on the map, and the
 * building page opens. An address is found through the geocoder, the map flies there, and
 * the building under the point is looked up; while the map is still loading that part of
 * the city, the lookup is repeated a few times.
 */
export function StartPage() {
  const t = useT();
  const navigate = useRouter((s) => s.navigate);
  const setView = useStore((s) => s.setView);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "locating" | "notFound" | "error">(
    "idle",
  );
  const [marker, setMarker] = useState<{ lon: number; lat: number } | null>(null);
  /** The query the shown results belong to, so "nothing found" never shows before a search ran. */
  const [searched, setSearched] = useState("");
  const locateRun = useRef(0);

  const openBuilding = (gid: string) => {
    navigate({ page: "building", gid });
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    if (value.trim().length < 3) {
      setHits([]);
      setSearched("");
      setStatus("idle");
    }
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("searching");
      const request = GID_PATTERN.test(q)
        ? searchGid(q, controller.signal).then((found) =>
            found.map((h): Hit => ({ kind: "building", gid: h.buildingGid })),
          )
        : searchAddress(q, controller.signal).then((found) =>
            found.map((place): Hit => ({ kind: "place", place })),
          );
      request
        .then((found) => {
          setHits(found);
          setSearched(q);
          setStatus("idle");
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus("error");
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  /** Fly to an address and open the building standing on it, once the map has loaded it. */
  const choosePlace = async (place: Place) => {
    const run = ++locateRun.current;
    setMarker({ lon: place.lon, lat: place.lat });
    setView({ lon: place.lon, lat: place.lat, zoom: 18 });
    setStatus("locating");
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        const gid = await buildingAtPoint(place.lon, place.lat);
        if (run !== locateRun.current) return;
        if (gid) {
          openBuilding(gid);
          return;
        }
      } catch {
        if (run === locateRun.current) setStatus("error");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, RETRY_MS));
      if (run !== locateRun.current) return;
    }
    setStatus("notFound");
  };

  return (
    <div className="grid h-full grid-cols-[minmax(420px,34%)_1fr]">
      <section className="flex min-h-0 flex-col overflow-y-auto border-r border-line bg-paper px-10 pt-12 pb-8">
        <h1 className="text-xl leading-tight font-semibold">{t("start.title")}</h1>
        <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">
          {t("start.subtitle")}
        </p>

        <label className="relative mt-6 block">
          <span className="sr-only">{t("start.searchLabel")}</span>
          <Search
            size={17}
            aria-hidden
            className="absolute top-1/2 left-5 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={query}
            autoFocus
            placeholder={t("start.searchPlaceholder")}
            onChange={(e) => {
              changeQuery(e.target.value);
            }}
            className="h-12 w-full rounded-control border border-line bg-paper pr-5 pl-12 text-base text-ink shadow-soft outline-none placeholder:text-muted focus:border-select"
          />
          {status === "searching" && (
            <Loader2
              size={16}
              aria-hidden
              className="absolute top-1/2 right-5 -translate-y-1/2 animate-spin text-muted"
            />
          )}
        </label>

        <ul className="mt-5 flex flex-col" aria-label={t("start.results")}>
          {hits.map((hit) => (
            <li key={hit.kind === "place" ? `${hit.place.main}|${hit.place.area}` : hit.gid}>
              <button
                type="button"
                onClick={() => {
                  if (hit.kind === "place") void choosePlace(hit.place);
                  else openBuilding(hit.gid);
                }}
                className="flex w-full items-center gap-4 rounded-inner px-4 py-3.5 text-left transition-colors hover:bg-paper"
              >
                {hit.kind === "place" ? (
                  <MapPin size={18} aria-hidden className="shrink-0 fill-ink text-panel" />
                ) : (
                  <Building2 size={18} aria-hidden className="shrink-0 text-ink" />
                )}
                <span className="min-w-0 truncate text-[15px]">
                  {hit.kind === "place" ? (
                    <>
                      <b className="font-semibold text-ink">{hit.place.main}</b>
                      {hit.place.area && <span className="text-muted">, {hit.place.area}</span>}
                    </>
                  ) : (
                    <b className="font-semibold text-ink">{hit.gid}</b>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <StatusLine
          status={status}
          noResults={hits.length === 0 && searched !== "" && searched === query.trim()}
        />
        <p className="mt-auto pt-10 text-xs leading-relaxed text-muted">{t("start.hint")}</p>
      </section>
      <BuildingMap selectedGid={null} marker={marker} onPick={openBuilding} />
    </div>
  );
}

function StatusLine({
  status,
  noResults,
}: {
  status: "idle" | "searching" | "locating" | "notFound" | "error";
  noResults: boolean;
}) {
  const t = useT();
  if (status === "locating")
    return <p className="mt-3 px-4 text-sm text-muted">{t("start.locating")}</p>;
  if (status === "notFound")
    return <p className="mt-3 px-4 text-sm text-mark">{t("start.notFound")}</p>;
  if (status === "error") return <p className="mt-3 px-4 text-sm text-mark">{t("start.error")}</p>;
  if (status === "idle" && noResults) {
    return <p className="mt-3 px-4 text-sm text-muted">{t("start.noResults")}</p>;
  }
  return null;
}
