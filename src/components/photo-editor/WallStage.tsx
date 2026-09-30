import {
  type Opening,
  type ResizeHandle,
  imageToWall,
  moveOpening,
  openingContains,
  openingFromDrag,
  resizeHandleAt,
  resizeOpeningByHandle,
  wallToImage,
} from "lod2-core/openings";
import { type Point2, clampToImage, fitImage, photoToScreen, screenToPhoto } from "lod2-core/photo";
import { useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import { MIN_OPENING_M, WALL_PX_PER_METRE } from "@/components/photo-editor/constants";
import type { WallImage, WallView } from "@/components/photo-editor/types";
import { useElementSize } from "@/components/photo-editor/useElementSize";
import { useFormat } from "@/lod2/format";

/**
 * The rectified wall drawn to fit, with openings on top. Drag on empty wall to draw a new
 * opening; click an opening to select it. Everything is stored in wall metres.
 */
export function WallStage({
  wallImage,
  openings,
  selected,
  onAdd,
  onMove,
  onSelect,
  onDelete,
  onCopy,
  onPaste,
  view,
  outline,
}: {
  view: WallView;
  /** The model's wall outline in wall metres, drawn so the wall still reads without the photo. */
  outline: Point2[];
  wallImage: WallImage;
  openings: Opening[];
  selected: number | null;
  onAdd: (opening: Opening) => void;
  /** `gesture` is the same for every move of one drag, so the drag is one undo step. */
  onMove: (index: number, opening: Opening, gesture: string) => void;
  onSelect: (index: number | null) => void;
  onDelete: () => void;
  onCopy: () => void;
  /** The mouse position in wall metres, or null when the mouse is not over the wall. */
  onPaste: (point: Point2 | null) => void;
}) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const boxSize = useElementSize(stageRef);
  const [dragStart, setDragStart] = useState<Point2 | null>(null);
  const [dragEnd, setDragEnd] = useState<Point2 | null>(null);
  /** While moving an opening: which one, where the drag began, and where it was then. */
  const [moving, setMoving] = useState<{ index: number; from: Point2; origin: Opening } | null>(
    null,
  );
  /** While Ctrl-dragging an opening: which one, where the drag began, its size then, and the grabbed edges. */
  const [resizing, setResizing] = useState<{
    index: number;
    from: Point2;
    origin: Opening;
    handle: ResizeHandle;
  } | null>(null);
  /** Resize arrow shown while Ctrl is held over an opening; undefined keeps the crosshair. */
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  /** Last mouse position over the wall, in metres, for pasting and for Ctrl without moving. */
  const lastPointer = useRef<Point2 | null>(null);
  /** Counts drags, so each one gets its own undo step. */
  const gestureCount = useRef(0);

  const fit = fitImage(wallImage.width, wallImage.height, boxSize.width, boxSize.height);

  /** Mouse position to wall metres, clamped to the wall. */
  const mouseToWall = (event: React.PointerEvent): Point2 | null => {
    const stage = stageRef.current;
    if (!stage || fit.scale <= 0) return null;
    const rect = stage.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const pixel = clampToImage(screenToPhoto(screen, fit), wallImage.width, wallImage.height);
    return imageToWall(pixel, wallImage.height, WALL_PX_PER_METRE);
  };

  /** Wall metres to a screen position inside the stage. */
  const wallToScreen = (point: Point2): Point2 => {
    return photoToScreen(wallToImage(point, wallImage.height, WALL_PX_PER_METRE), fit);
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = mouseToWall(event);
    if (!point) return;
    const hit = openings.findIndex((o) => openingContains(o, point));
    // Undefined when the pointer is on no opening (index -1).
    const grabbed = openings[hit];
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureCount.current += 1;
    if (grabbed && (event.ctrlKey || event.metaKey)) {
      // Ctrl on an opening resizes it from the zone that was grabbed.
      const origin = grabbed;
      const handle = resizeHandleAt(origin, point);
      onSelect(hit);
      setResizing({ index: hit, from: point, origin, handle });
      setCursor(cursorForHandle(handle));
      return;
    }
    if (grabbed) {
      // Clicking an opening selects it; dragging it from there moves it.
      onSelect(hit);
      setMoving({ index: hit, from: point, origin: grabbed });
      return;
    }
    onSelect(null);
    setDragStart(point);
    setDragEnd(point);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = mouseToWall(event);
    if (!point) return;
    lastPointer.current = point;
    if (resizing) {
      const dx = point.x - resizing.from.x;
      const dy = point.y - resizing.from.y;
      onMove(
        resizing.index,
        resizeOpeningByHandle(resizing.origin, resizing.handle, dx, dy, MIN_OPENING_M),
        `drag${gestureCount.current}`,
      );
      return;
    }
    if (moving) {
      const dx = point.x - moving.from.x;
      const dy = point.y - moving.from.y;
      onMove(moving.index, moveOpening(moving.origin, dx, dy), `drag${gestureCount.current}`);
      return;
    }
    if (dragStart) {
      setDragEnd(point);
      return;
    }
    refreshCursor(point, event.ctrlKey || event.metaKey);
  };

  /** Show the resize arrow for the zone under the mouse while Ctrl is held over an opening. */
  const refreshCursor = (point: Point2 | null, ctrlHeld: boolean) => {
    const hit = point ? openings.find((o) => openingContains(o, point)) : undefined;
    if (!point || !hit || !ctrlHeld) {
      setCursor(undefined);
      return;
    }
    setCursor(cursorForHandle(resizeHandleAt(hit, point)));
  };

  const endDrag = () => {
    if (dragStart && dragEnd) {
      const opening = openingFromDrag(dragStart, dragEnd);
      if (opening.width >= MIN_OPENING_M && opening.height >= MIN_OPENING_M) onAdd(opening);
    }
    setDragStart(null);
    setDragEnd(null);
    setMoving(null);
    setResizing(null);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const ctrlHeld = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (event.key === "Delete" || event.key === "Backspace") {
      onDelete();
      return;
    }
    if (ctrlHeld && key === "c") {
      event.preventDefault();
      onCopy();
      return;
    }
    if (ctrlHeld && key === "v") {
      event.preventDefault();
      onPaste(lastPointer.current);
      return;
    }
    // Pressing Ctrl without moving the mouse should still show the resize arrow.
    if (!resizing) refreshCursor(lastPointer.current, ctrlHeld);
  };

  const onKeyUp = (event: React.KeyboardEvent) => {
    if (!resizing) refreshCursor(lastPointer.current, event.ctrlKey || event.metaKey);
  };

  const onPointerLeave = () => {
    lastPointer.current = null;
    if (!resizing) setCursor(undefined);
  };

  const draft = dragStart && dragEnd ? openingFromDrag(dragStart, dragEnd) : null;

  return (
    <div
      className="photo-editor-stage drawing"
      ref={stageRef}
      tabIndex={0}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      style={{ cursor }}
    >
      <img
        className="photo-editor-image"
        src={wallImage.url}
        alt={t("photo.alt.wall")}
        draggable={false}
        style={{
          width: fit.width,
          height: fit.height,
          left: fit.offsetX,
          top: fit.offsetY,
          opacity: 1 - view.transparency / 100,
        }}
      />
      <svg className="wall-outline" aria-hidden>
        <polygon
          points={outline
            .map((p) => {
              const s = wallToScreen(p);
              return `${s.x},${s.y}`;
            })
            .join(" ")}
        />
      </svg>
      {openings.map((opening, index) => (
        <OpeningBox
          key={index}
          opening={opening}
          selected={index === selected}
          showSize={view.showSizes}
          toScreen={wallToScreen}
        />
      ))}
      {draft && (
        <OpeningBox
          opening={draft}
          selected={false}
          draft
          showSize={view.showSizes}
          toScreen={wallToScreen}
        />
      )}
    </div>
  );
}

/**
 * The CSS resize cursor for the grabbed edges. Wall metres run up, so a top-right or
 * bottom-left grab is the north-east arrow on screen.
 */
function cursorForHandle(handle: ResizeHandle): string {
  if (handle.x !== 0 && handle.y !== 0)
    return handle.x === handle.y ? "nesw-resize" : "nwse-resize";
  if (handle.x !== 0) return "ew-resize";
  return "ns-resize";
}

/** One opening drawn on the stage, labelled with its size in metres. */
function OpeningBox({
  opening,
  selected,
  draft = false,
  showSize,
  toScreen,
}: {
  opening: Opening;
  selected: boolean;
  draft?: boolean;
  showSize: boolean;
  toScreen: (point: Point2) => Point2;
}) {
  const format = useFormat();
  // Top-left on screen is the opening's top-left in wall metres: (x, y + height).
  const topLeft = toScreen({ x: opening.x, y: opening.y + opening.height });
  const bottomRight = toScreen({ x: opening.x + opening.width, y: opening.y });
  const className = `opening-box${selected ? " selected" : ""}${draft ? " draft" : ""}${opening.score !== undefined ? " proposed" : ""}`;
  return (
    <div
      className={className}
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      }}
    >
      {/* Width over height, small, so the label fits inside a typical window. */}
      {showSize && (
        <span className="opening-label" title={format.size(opening.width, opening.height)}>
          <span>{format.num(opening.width, 2)} x</span>
          <span>{format.num(opening.height, 2)} m</span>
        </span>
      )}
    </div>
  );
}
