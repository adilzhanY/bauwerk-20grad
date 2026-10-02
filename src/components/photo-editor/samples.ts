/**
 * Sample facade photos for someone without a photo at hand, and pasting a copied image.
 *
 * The samples are the photos in `lod2/sample-photos/`, each of a building inside the area
 * `npm run bootstrap` loads and named after its Gebäude-ID. The three phone photos keep their
 * Exif (the editor reads the compass direction from it); the street-level views after them
 * have none. Their thumbnails are small copies without metadata.
 */
import type { MessageKey } from "@/i18n";

const PHOTOS = import.meta.glob<string>("/lod2/sample-photos/*.jpg", {
  query: "?url",
  import: "default",
  eager: true,
});
const THUMBS = import.meta.glob<string>("/lod2/sample-photos/thumbs/*.jpg", {
  query: "?url",
  import: "default",
  eager: true,
});

export interface SamplePhoto {
  /** The file name without ".jpg": the Gebäude-ID, with a suffix for a second photo. */
  id: string;
  /** Gebäude-ID of the building the photo shows. */
  gid: string;
  caption: MessageKey;
  url: string;
  thumb: string;
}

const LIST: { id: string; gid: string; caption: MessageKey }[] = [
  { id: "DEBE02YY40000BOo", gid: "DEBE02YY40000BOo", caption: "photo.sample.red" },
  { id: "DEBE02YY40000Atr", gid: "DEBE02YY40000Atr", caption: "photo.sample.yellow" },
  { id: "DEBE02YY400000kY", gid: "DEBE02YY400000kY", caption: "photo.sample.corner" },
  { id: "DEBE02YY400001Vh", gid: "DEBE02YY400001Vh", caption: "photo.sample.pub" },
  { id: "DEBE02YY400003eq", gid: "DEBE02YY400003eq", caption: "photo.sample.tiles" },
  { id: "DEBE02YY40000BOo-street", gid: "DEBE02YY40000BOo", caption: "photo.sample.redStreet" },
  {
    id: "DEBE02YY40000Atr-street",
    gid: "DEBE02YY40000Atr",
    caption: "photo.sample.yellowStreet",
  },
];

export const SAMPLE_PHOTOS: SamplePhoto[] = LIST.flatMap(({ id, gid, caption }) => {
  const url = PHOTOS[`/lod2/sample-photos/${id}.jpg`];
  const thumb = THUMBS[`/lod2/sample-photos/thumbs/${id}.jpg`];
  return url && thumb ? [{ id, gid, caption, url, thumb }] : [];
});

/** The samples, the ones of `buildingGid` first when there are any. */
export function samplesFor(buildingGid: string | null): SamplePhoto[] {
  const own = SAMPLE_PHOTOS.filter((s) => s.gid === buildingGid);
  return [...own, ...SAMPLE_PHOTOS.filter((s) => s.gid !== buildingGid)];
}

/** Downloads a sample as a file, the same as if it had been chosen from the disk. */
export async function sampleFile(
  sample: SamplePhoto,
  fetchImpl: typeof fetch = fetch,
): Promise<File> {
  const res = await fetchImpl(sample.url);
  if (!res.ok) throw new Error(`sample ${sample.id}: ${res.status}`);
  const blob = await res.blob();
  // The samples are JPEGs, whatever content type a server labels them with.
  const type = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  return new File([blob], `${sample.id}.jpg`, { type });
}
