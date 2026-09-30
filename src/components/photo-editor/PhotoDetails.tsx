import { Presence } from "@/components/shared/Presence";
import { type ExifSummary, sizesMatchIgnoringRotation } from "lod2-core/exif";
import type { Quad } from "lod2-core/photo";
import type { MessageKey } from "@/i18n";
import { useT } from "@/i18n/useT";
import { CustomReadOnly, CustomSection } from "@/components/shared/CustomField";
import { Hint } from "@/components/shared/Hint";
import { cornerLabel } from "@/components/photo-editor/constants";
import type { PhotoSize } from "@/components/photo-editor/types";
import { useFormat } from "@/lod2/format";

type Num = (value: number, digits: number) => string;

/** "-" for a missing value, otherwise the number with a fixed number of decimals and a unit. */
function formatValue(num: Num, value: number | null, digits: number, unit = ""): string {
  if (value === null) return "-";
  return `${num(value, digits)}${unit}`;
}

/** Shutter speed the way cameras print it: "1/631 s", or "2.0 s" for long exposures. */
function formatShutter(num: Num, seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "-";
  if (seconds >= 1) return `${num(seconds, 1)} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

/** Plain words for the Exif orientation codes a phone actually writes. */
const ORIENTATIONS: Partial<Record<number, MessageKey>> = {
  1: "photo.orientation.upright",
  3: "photo.orientation.upsideDown",
  6: "photo.orientation.clockwise",
  8: "photo.orientation.anticlockwise",
};

/**
 * True when the Exif block states a pixel size that differs from the decoded image, even after
 * swapping width and height. The same size rotated is normal for portrait phone photos.
 */
function exifSizeDisagrees(exif: ExifSummary, photoSize: PhotoSize | null): boolean {
  if (!photoSize || exif.pixelWidth === null || exif.pixelHeight === null) return false;
  return !sizesMatchIgnoringRotation(
    exif.pixelWidth,
    exif.pixelHeight,
    photoSize.width,
    photoSize.height,
  );
}

/** A stack of label and value rows inside a section. */
function Rows({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

/** Camera, exposure, image and location as the photo's Exif block states them. */
export function PhotoDetails({
  exif,
  photoSize,
  hasPhoto,
}: {
  exif: ExifSummary | null | undefined;
  photoSize: PhotoSize | null;
  hasPhoto: boolean;
}) {
  const format = useFormat();
  const t = useT();
  if (!hasPhoto || exif === undefined || exif === null) {
    const message = !hasPhoto
      ? t("photo.exif.noPhoto")
      : exif === undefined
        ? t("photo.exif.reading")
        : t("photo.exif.none");
    return (
      <CustomSection title={t("photo.details")} first>
        <Hint>{message}</Hint>
      </CustomSection>
    );
  }

  const focal =
    exif.focalLength35mm === null
      ? formatValue(format.num, exif.focalLengthMm, 2, " mm")
      : t("photo.focalEquivalent", {
          focal: formatValue(format.num, exif.focalLengthMm, 2, " mm"),
          mm: exif.focalLength35mm,
        });
  const direction = exif.direction
    ? `${format.num(exif.direction.degrees, 1)}°${exif.direction.ref ? ` (${exif.direction.ref})` : ""}`
    : "-";
  const exifSize =
    exif.pixelWidth === null || exif.pixelHeight === null
      ? "-"
      : `${exif.pixelWidth} x ${exif.pixelHeight} px`;
  const orientationKey = exif.orientation === null ? undefined : ORIENTATIONS[exif.orientation];
  const orientation =
    exif.orientation === null
      ? "-"
      : orientationKey
        ? t(orientationKey)
        : t("photo.orientation.code", { code: exif.orientation });

  return (
    <>
      <CustomSection title={t("photo.camera")} first>
        <Rows>
          <CustomReadOnly label={t("photo.make")} value={exif.make ?? "-"} />
          <CustomReadOnly label={t("photo.model")} value={exif.model ?? "-"} />
          <CustomReadOnly label={t("photo.lens")} value={exif.lensModel ?? "-"} />
          <CustomReadOnly label={t("photo.software")} value={exif.software ?? "-"} />
          <CustomReadOnly label={t("photo.taken")} value={exif.dateTaken ?? "-"} />
        </Rows>
      </CustomSection>
      <CustomSection title={t("photo.lensExposure")}>
        <Rows>
          <CustomReadOnly label={t("photo.focalLength")} value={focal} />
          <CustomReadOnly
            label={t("photo.aperture")}
            value={exif.fNumber === null ? "-" : `f/${format.num(exif.fNumber, 1)}`}
          />
          <CustomReadOnly
            label={t("photo.shutter")}
            value={formatShutter(format.num, exif.exposureSeconds)}
          />
          <CustomReadOnly
            label={t("photo.iso")}
            value={exif.iso === null ? "-" : String(exif.iso)}
          />
        </Rows>
      </CustomSection>
      <CustomSection title={t("photo.image")}>
        <Rows>
          <CustomReadOnly
            label={t("photo.decodedSize")}
            value={photoSize ? `${photoSize.width} x ${photoSize.height} px` : "-"}
          />
          <CustomReadOnly label={t("photo.exifSize")} value={exifSize} />
          <CustomReadOnly label={t("photo.orientation")} value={orientation} />
        </Rows>
        <Presence show={exifSizeDisagrees(exif, photoSize)}>
          <Hint error>{t("photo.sizeMismatch")}</Hint>
        </Presence>
      </CustomSection>
      <CustomSection title={t("photo.location")}>
        <Hint>{t("photo.locationHint")}</Hint>
        <Rows>
          <CustomReadOnly
            label={t("photo.latitude")}
            value={formatValue(format.num, exif.latitude, 6, "°")}
          />
          <CustomReadOnly
            label={t("photo.longitude")}
            value={formatValue(format.num, exif.longitude, 6, "°")}
          />
          <CustomReadOnly
            label={t("photo.altitude")}
            value={formatValue(format.num, exif.altitudeM, 1, " m")}
          />
          <CustomReadOnly
            label={t("photo.positionError")}
            value={formatValue(format.num, exif.positionErrorM, 1, " m")}
          />
          <CustomReadOnly label={t("photo.cameraDirection")} value={direction} />
        </Rows>
      </CustomSection>
    </>
  );
}

/** The four dots' positions in photo pixels, for checking them against the photo. */
export function CornerTable({ corners }: { corners: Quad }) {
  const t = useT();
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-xs text-muted">
          <th className="px-1.5 pb-1 text-left font-medium">{t("photo.corner")}</th>
          <th className="px-1.5 pb-1 text-right font-medium">x (px)</th>
          <th className="px-1.5 pb-1 text-right font-medium">y (px)</th>
        </tr>
      </thead>
      <tbody>
        {corners.map((corner, index) => (
          <tr key={index} className="text-ink">
            <td className="px-1.5 py-1 text-left">
              <span className={`corner-swatch corner-${index}`} />
              {index + 1} {t(cornerLabel(index))}
            </td>
            <td className="px-1.5 py-1 text-right font-num">{Math.round(corner.x)}</td>
            <td className="px-1.5 py-1 text-right font-num">{Math.round(corner.y)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
