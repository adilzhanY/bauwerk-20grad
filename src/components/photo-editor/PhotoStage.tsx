import {
  type Fit,
  type Point2,
  type Quad,
  clampToImage,
  fitImageWithMargin,
  loupeBackground,
  photoToScreen,
  screenToPhoto,
} from "lod2-core/photo";
import { useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import { cx } from "@/components/shared/cx";
import { AiScan } from "@/components/shared/ai/AiScan";
import {
  cornerLabel,
  LOUPE_GAP_PX,
  LOUPE_SIZE_PX,
  LOUPE_ZOOM_MAX,
  LOUPE_ZOOM_MIN,
  LOUPE_ZOOM_STEP,
  STAGE_MARGIN_PX,
} from "@/components/photo-editor/constants";
import type { PhotoSize } from "@/components/photo-editor/types";
import { useElementSize } from "@/components/photo-editor/useElementSize";

/** The photo drawn to fit its box, with the four draggable corner dots on top. */
export function PhotoStage({
  scanning,
  dotsProposed,
  photoUrl,
  loupeUrl,
  loupeZoom,
  onLoupeZoom,
  photoSize,
  corners,
  onPhotoLoaded,
  onPhotoError,
  onCornersChange,
}: {
  scanning: boolean;
  dotsProposed: boolean;
  photoUrl: string;
  loupeUrl: string | null;
  loupeZoom: number;
  onLoupeZoom: (update: (zoom: number) => number) => void;
  photoSize: PhotoSize | null;
  corners: Quad | null;
  onPhotoLoaded: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  onPhotoError: () => void;
  onCornersChange: (corners: Quad) => void;
}) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const boxSize = useElementSize(stageRef);
  const [dragging, setDragging] = useState<number | null>(null);

  const fit: Fit | null = photoSize
    ? fitImageWithMargin(
        photoSize.width,
        photoSize.height,
        boxSize.width,
        boxSize.height,
        STAGE_MARGIN_PX,
      )
    : null;

  const mouseToPhoto = (event: React.PointerEvent): Point2 | null => {
    const stage = stageRef.current;
    if (!stage || !fit || !photoSize) return null;
    const rect = stage.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return clampToImage(screenToPhoto(screen, fit), photoSize.width, photoSize.height);
  };

  const startDrag = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(index);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging === null || !corners) return;
    const point = mouseToPhoto(event);
    if (!point) return;
    const next = [...corners] as Quad;
    next[dragging] = point;
    onCornersChange(next);
  };

  const endDrag = () => {
    setDragging(null);
  };

  const draggedCorner = dragging === null || !corners ? null : corners[dragging];

  return (
    <div
      className={cx("photo-editor-stage", scanning && "pointer-events-none")}
      ref={stageRef}
      onWheel={(event) => {
        // The wheel changes the loupe's magnification, also mid-drag, so a corner can be
        // aimed with the zoom that suits it. The stage never scrolls, so nothing is lost.
        const direction = event.deltaY < 0 ? 1 : -1;
        // An updater, so two wheel events before the next render both count.
        onLoupeZoom((zoom) => {
          const next = zoom + direction * LOUPE_ZOOM_STEP;
          return Math.min(LOUPE_ZOOM_MAX, Math.max(LOUPE_ZOOM_MIN, Math.round(next * 4) / 4));
        });
      }}
    >
      <img
        className="photo-editor-image"
        src={photoUrl}
        alt={t("photo.alt.photo")}
        draggable={false}
        decoding="async"
        onLoad={onPhotoLoaded}
        onError={onPhotoError}
        style={
          fit
            ? { width: fit.width, height: fit.height, left: fit.offsetX, top: fit.offsetY }
            : undefined
        }
      />
      {scanning && <AiScan />}
      {fit && corners && <CornerOutline corners={corners} fit={fit} />}
      {fit && photoSize && draggedCorner && loupeUrl && (
        <Loupe
          photoUrl={loupeUrl}
          photoSize={photoSize}
          zoom={loupeZoom}
          point={draggedCorner}
          anchor={photoToScreen(draggedCorner, fit)}
          stageWidth={boxSize.width}
          stageHeight={boxSize.height}
        />
      )}
      {fit &&
        corners?.map((corner, index) => {
          const screen = photoToScreen(corner, fit);
          return (
            <div
              key={index}
              className={`corner-dot corner-${index}${dragging === index ? " dragging" : ""}${dotsProposed ? " proposed" : ""}`}
              style={{ left: screen.x, top: screen.y }}
              title={t(cornerLabel(index))}
              onPointerDown={startDrag(index)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {index + 1}
            </div>
          );
        })}
    </div>
  );
}

/**
 * Zoomed view of the photo around the dot being dragged, with a crosshair on the exact
 * pixel. Sits diagonally away from the dot, on whichever side has room inside the stage.
 */
function Loupe({
  photoUrl,
  photoSize,
  zoom,
  point,
  anchor,
  stageWidth,
  stageHeight,
}: {
  photoUrl: string;
  photoSize: PhotoSize;
  zoom: number;
  point: Point2;
  anchor: Point2;
  stageWidth: number;
  stageHeight: number;
}) {
  const loupe = loupeBackground(point, photoSize.width, photoSize.height, zoom, LOUPE_SIZE_PX);
  const left = placeBeside(anchor.x, stageWidth);
  const top = placeBeside(anchor.y, stageHeight);

  return (
    <div
      className="loupe"
      style={{
        left,
        top,
        width: LOUPE_SIZE_PX,
        height: LOUPE_SIZE_PX,
        backgroundImage: `url(${photoUrl})`,
        backgroundSize: `${loupe.backgroundWidth}px ${loupe.backgroundHeight}px`,
        backgroundPosition: `${loupe.backgroundX}px ${loupe.backgroundY}px`,
      }}
    >
      <span className="loupe-cross horizontal" />
      <span className="loupe-cross vertical" />
    </div>
  );
}

/**
 * Offset of the loupe along one axis: after the dot if that fits inside the stage,
 * otherwise before it.
 */
function placeBeside(dotPosition: number, stageSize: number): number {
  const after = dotPosition + LOUPE_GAP_PX;
  if (after + LOUPE_SIZE_PX <= stageSize) return after;
  return dotPosition - LOUPE_GAP_PX - LOUPE_SIZE_PX;
}

/** Lines joining the four dots in order, white over a dark edge so they show on any photo. */
function CornerOutline({ corners, fit }: { corners: Quad; fit: Fit }) {
  const points = corners
    .map((corner) => {
      const screen = photoToScreen(corner, fit);
      return `${screen.x},${screen.y}`;
    })
    .join(" ");
  return (
    <svg className="corner-outline" aria-hidden>
      <polygon points={points} className="corner-outline-shadow" />
      <polygon points={points} className="corner-outline-line" />
    </svg>
  );
}
