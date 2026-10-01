import { Presence } from "@/components/shared/Presence";
import { useModal } from "@/components/shared/useModal";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Opening } from "lod2-core/openings";
import {
  readCompassDirection,
  readExifSummary,
  type CompassDirection,
  type ExifSummary,
} from "lod2-core/exif";
import { insetCorners, type Quad } from "lod2-core/photo";
import { useT } from "@/i18n/useT";
import { inTextField } from "@/lib/inTextField";
import { UserError, errorText } from "@/lod2/api/errors";
import { CustomSection } from "@/components/shared/CustomField";
import { cx } from "@/components/shared/cx";
import { useStore, wallKey } from "@/lod2/state/store";
import { useSelectedSurface } from "@/lod2/state/selectedWall";
import { useSurvey } from "@/lod2/state/survey";
import { AiScan } from "@/components/shared/ai/AiScan";
import {
  BASE_HIDDEN_WARN,
  CORNER_INSET_FRACTION,
  LOUPE_ZOOM_DEFAULT,
} from "@/components/photo-editor/constants";
import { describeCompass, describeWall } from "@/components/photo-editor/describe";
import { detectOpeningsOnly, detectWall } from "@/components/photo-editor/detection";
import { EditorHeader } from "@/components/photo-editor/EditorHeader";
import { EditorSideColumn } from "@/components/photo-editor/EditorSideColumn";
import { buildWallImage, makeWorkingPhoto, sameCorners } from "@/components/photo-editor/images";
import { OpeningsToolbar, SummaryStrip } from "@/components/photo-editor/OpeningsPanels";
import { CornerTable, PhotoDetails } from "@/components/photo-editor/PhotoDetails";
import { PhotoEmptyState } from "@/components/photo-editor/PhotoEmptyState";
import { PhotoStage } from "@/components/photo-editor/PhotoStage";
import { pastedImage, sampleFile } from "@/components/photo-editor/samples";
import { EditorNotices } from "@/components/photo-editor/EditorNotices";
import type {
  EditorMode,
  PhotoSize,
  WallImage,
  WallView,
  WorkingPhoto,
} from "@/components/photo-editor/types";
import { useDetectionJob } from "@/components/photo-editor/useDetectionJob";
import { useOpenings } from "@/components/photo-editor/useOpenings";
import { MOTION_MS, usePresence } from "@/components/shared/usePresence";
import { useWallGeometry } from "@/components/photo-editor/useWallGeometry";
import type { WallGeometry } from "@/components/photo-editor/useWallGeometry";
import { WallStage } from "@/components/photo-editor/WallStage";
import { useFormat } from "@/lod2/format";
import { useVisionAvailable } from "@/lod2/api/useVisionAvailable";

/** Someone waiting for the next photo to load: the detection, while it swaps in the painted photo. */
interface PhotoWaiter {
  resolve: (img: HTMLImageElement) => void;
  reject: (error: Error) => void;
}

/**
 * Full-screen overlay for matching a photograph to the selected wall.
 *
 * The photo never leaves the browser unless "Detect openings" sends it to lod2-vision. It is
 * held as an object URL for as long as the editor is open and released when it closes. The
 * four corner dots are stored in photo pixels, so resizing the window moves them on screen
 * but not on the photo.
 */
export function PhotoEditor({ renderAction }: Pick<PhotoEditorProps, "renderAction"> = {}) {
  const open = useStore((s) => s.photoEditorOpen);
  const close = useStore((s) => s.closePhotoEditor);
  const wall = useWallGeometry();

  // Every change to the openings of a straightened wall goes into the building's survey.
  const surface = useSelectedSurface();
  const partGid = surface?.kind === "wall" ? surface.ref.partGid : null;
  const surfaceIndex = surface?.kind === "wall" ? surface.ref.surfaceIndex : null;
  const buildingGid = useStore((s) => s.building?.buildingGid ?? null);
  const saveWall = useSurvey((s) => s.saveWall);
  const onOpeningsChange = useCallback(
    (openings: Opening[], photoName: string | null) => {
      if (partGid === null || surfaceIndex === null || !buildingGid) return;
      saveWall(buildingGid, wallKey({ partGid, surfaceIndex }), {
        partGid,
        surfaceIndex,
        openings,
        ...(photoName ? { photo: photoName } : {}),
        method: openings.some((o) => o.score !== undefined) ? "detected" : "drawn",
        updatedAt: Date.now(),
      });
    },
    [partGid, surfaceIndex, buildingGid, saveWall],
  );

  return (
    <PhotoEditorView
      open={open}
      onClose={close}
      wall={wall}
      buildingGid={buildingGid}
      onOpeningsChange={onOpeningsChange}
      renderAction={renderAction}
    />
  );
}

export interface PhotoEditorProps {
  open: boolean;
  onClose: () => void;
  wall: WallGeometry;
  /** The Gebäude-ID of the building, so its own sample photo is offered first. */
  buildingGid?: string | null;
  /** The wall's openings whenever they change, once a straightened wall exists. */
  onOpeningsChange?: (openings: Opening[], photoName: string | null) => void;
  /** More for the side column on the wall step, from the openings as they are. */
  renderSide?: (openings: Opening[], photoName: string | null) => React.ReactNode;
  /** The header's last action on the wall step. */
  renderAction?: (
    openings: Opening[],
    photoName: string | null,
    wallImage: WallImage | null,
  ) => React.ReactNode;
}

/** The photo editor itself, for any wall: the LoD2 building's, or one of the 3D editor's. */
export function PhotoEditorView({
  open,
  onClose: close,
  wall,
  buildingGid = null,
  onOpeningsChange,
  renderSide,
  renderAction,
}: PhotoEditorProps) {
  const format = useFormat();
  const t = useT();
  const openings = useOpenings(wall.plane, wall.area);
  const job = useDetectionJob();
  const visionUp = useVisionAvailable(open);
  // Stays mounted while the close animation plays.
  const presence = usePresence(open ? true : null);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoSize, setPhotoSize] = useState<PhotoSize | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  /** File name of the chosen photo, kept with the survey as the source of its openings. */
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [corners, setCorners] = useState<Quad | null>(null);
  const [working, setWorking] = useState<WorkingPhoto | null>(null);
  const [loupeZoom, setLoupeZoom] = useState(LOUPE_ZOOM_DEFAULT);
  /** True while the dots are where the detector put them, until one is dragged. */
  const [dotsProposed, setDotsProposed] = useState(false);
  const [wallImage, setWallImage] = useState<WallImage | null>(null);
  /** Compass direction from the photo's Exif. Undefined until the file has been read. */
  const [compass, setCompass] = useState<CompassDirection | null | undefined>(undefined);
  /** Exif fields shown in the left panel: undefined while reading, null when the file has none. */
  const [exif, setExif] = useState<ExifSummary | null | undefined>(undefined);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [mode, setMode] = useState<EditorMode>("photo");
  /** Display only, kept while the editor is open, so it survives a new photo. */
  const [wallView, setWallView] = useState<WallView>({ transparency: 0, showSizes: true });
  /** Warning kept after the overlay is gone: how much of the base the detector could not see. */
  const [baseHiddenNote, setBaseHiddenNote] = useState<number | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const photoElement = useRef<HTMLImageElement | null>(null);
  /** Corners to use for the next photo that loads, instead of the default inset. */
  const pendingCorners = useRef<Quad | null>(null);
  const photoWaiters = useRef<PhotoWaiter[]>([]);
  /**
   * Bumped whenever the photo is replaced or the editor closes. Async work started for an
   * older photo (Exif reading, Apply) checks it and drops its result instead of landing it
   * on the new one.
   */
  const session = useRef(0);

  // Release the object URLs whenever they are replaced or the editor unmounts.
  useEffect(() => {
    if (!photoUrl?.startsWith("blob:")) return;
    return () => {
      URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);
  useEffect(() => {
    if (!wallImage) return;
    return () => {
      URL.revokeObjectURL(wallImage.url);
    };
  }, [wallImage]);

  // Nothing is reported before a wall image exists, so opening and closing the editor on a
  // surveyed wall never wipes what was measured before.
  const openingList = openings.list;
  useEffect(() => {
    if (wallImage) onOpeningsChange?.(openingList, photoName);
  }, [openingList, wallImage, photoName, onOpeningsChange]);

  // Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes the openings while the wall is edited.
  // A text field keeps its own undo.
  const { undo, redo } = openings;
  useEffect(() => {
    if (!open || mode !== "wall") return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || inTextField(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) undo();
      else if (key === "y" || (key === "z" && event.shiftKey)) redo();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, mode, undo, redo]);

  /** Forget everything about the current photo, its dots, its wall image and its openings. */
  const resetPhoto = () => {
    session.current += 1;
    job.cancel();
    setApplying(false);
    setBaseHiddenNote(null);
    pendingCorners.current = null;
    rejectPhotoWaiters(new UserError("photo.error.replaced"));
    setPhotoUrl(null);
    setPhotoSize(null);
    setPhotoError(null);
    setCorners(null);
    setWorking(null);
    setWallImage(null);
    setApplyError(null);
    setMode("photo");
    openings.clear();
    setDotsProposed(false);
    setCompass(undefined);
    setExif(undefined);
  };

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    event.target.value = "";
    if (file) loadPhoto(file);
  };

  const chooseFromDisk = () => {
    fileInput.current?.click();
  };

  /**
   * A new photo, from the disk, a sample or the clipboard: everything before it is forgotten,
   * and the detection starts on it (corners, straightening, openings), however it arrived.
   * Without the vision service the corners are placed by hand.
   */
  const loadPhoto = (file: File) => {
    resetPhoto();
    setPhotoName(file.name);
    const mine = session.current;
    void file.arrayBuffer().then((buffer) => {
      if (session.current !== mine) return;
      const bytes = new Uint8Array(buffer);
      // Only the compass direction is used from the Exif position block. The GPS position in
      // these photos is metres off, so it is never used.
      setCompass(readCompassDirection(bytes));
      setExif(readExifSummary(bytes));
    });
    setPhotoUrl(URL.createObjectURL(file));
    // Unknown (still asking) counts as there: if it is not, the detection card says so.
    if (visionUp !== false) void runDetection(file);
  };

  const onPhotoLoaded = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    photoElement.current = img;
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    setPhotoSize(size);
    // The stage is rebuilt every time "Back to photo" is pressed and the photo loads again,
    // so the dots already placed, by hand or by the detector, must survive that load. Only a
    // photo with no dots yet gets the default inset.
    const proposed = pendingCorners.current;
    pendingCorners.current = null;
    if (proposed) setDotsProposed(true);
    setCorners(
      (current) =>
        proposed ?? current ?? insetCorners(size.width, size.height, CORNER_INSET_FRACTION),
    );
    setWorking(makeWorkingPhoto(img));
    const waiters = photoWaiters.current;
    photoWaiters.current = [];
    for (const waiter of waiters) waiter.resolve(img);
  };

  const onPhotoError = () => {
    setPhotoError(t("photo.error.notImage"));
    setPhotoUrl(null);
    rejectPhotoWaiters(new UserError("photo.error.photoFailed"));
  };

  function rejectPhotoWaiters(error: UserError) {
    const waiters = photoWaiters.current;
    photoWaiters.current = [];
    for (const waiter of waiters) waiter.reject(error);
  }

  /** Swap in the painted photo with the proposed dots, and wait until it has loaded. */
  const showPaintedPhoto = (url: string, proposed: Quad) => {
    pendingCorners.current = proposed;
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      photoWaiters.current.push({ resolve, reject });
    });
    setMode("photo");
    setPhotoUrl(url);
    return loaded;
  };

  const runDetection = (file: File) => {
    const plane = wall.plane;
    if (!plane) {
      job.setDetection({
        stage: "failed",
        startedAt: performance.now(),
        message: t("photo.error.notVertical"),
      });
      return Promise.resolve();
    }
    return job.run("corners", async (signal, startedAt, onAhead) => {
      const result = await detectWall(file, plane, {
        signal,
        onAhead,
        onStage: (stage, baseHidden) => {
          job.setDetection({ stage, startedAt, baseHidden });
          setBaseHiddenNote(baseHidden > BASE_HIDDEN_WARN ? baseHidden : null);
        },
        showPaintedPhoto,
        onWallImage: (image) => {
          setWallImage(image);
          openings.clear();
          setMode("wall");
        },
      });
      if (!result) return false;
      openings.replaceWithProposals(result.openings);
      return true;
    });
  };

  const detectOpeningsOn = (image: WallImage) => {
    void job.run("openings", async (signal, _startedAt, onAhead) => {
      const proposals = await detectOpeningsOnly(image, signal, onAhead);
      if (!proposals) return false;
      openings.replaceWithProposals(proposals);
      return true;
    });
  };

  const runOpeningsOnly = () => {
    if (!wallImage || !wall.plane) return;
    detectOpeningsOn(wallImage);
  };

  /** Asking whether the openings that are not in the model yet may be thrown away. */
  const [askClose, setAskClose] = useState(false);
  const discardAndClose = () => {
    setAskClose(false);
    job.cancel();
    close();
  };
  // Found or drawn openings, or a detection still running: closing would lose that work.
  const closeEditor = () => {
    if (openings.list.length > 0 || job.scanning) setAskClose(true);
    else discardAndClose();
  };
  // Escape, the focus trap and the way back to the opener, as every modal has them. Escape
  // takes the same way as the close button, so found openings are not lost without asking.
  const panel = useRef<HTMLDivElement>(null);
  useModal(panel, closeEditor, Boolean(open && presence.shown));

  // However the editor was closed, the photo is cleared once it has faded out, so it does
  // not empty while still visible. A reopen in that moment keeps what is there.
  const resetAfterClose = useEffectEvent(() => {
    resetPhoto();
  });
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(resetAfterClose, MOTION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [open]);

  // An image copied anywhere (a screenshot, a photo from another app) pasted into the editor
  // opens as the photo. Only while a photo is being placed: on the wall, Ctrl+V pastes an
  // opening, and a text field keeps its own paste.
  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    if (mode !== "photo" || inTextField(event.target)) return;
    const file = pastedImage(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    loadPhoto(file);
  });
  useEffect(() => {
    if (!open) return;
    const listener = (event: ClipboardEvent) => {
      onPaste(event);
    };
    document.addEventListener("paste", listener);
    return () => {
      document.removeEventListener("paste", listener);
    };
  }, [open]);

  const apply = () => {
    const img = photoElement.current;
    const plane = wall.plane;
    if (!img || !corners || !plane) return;
    const mine = session.current;
    setApplying(true);
    setApplyError(null);
    // Let the button repaint as "Working" before the synchronous resample starts.
    setTimeout(() => {
      buildWallImage(img, corners, plane)
        .then((result) => {
          if (session.current !== mine) {
            if (!(result instanceof UserError)) URL.revokeObjectURL(result.url);
            return;
          }
          if (result instanceof UserError) {
            setApplyError(errorText(result, t));
          } else {
            // New corners give a new wall picture, and the openings drawn on the old one no
            // longer sit on their windows: they are found again on the new one. Unchanged
            // corners (back to the photo and straight on) keep the openings as they were.
            const moved = !wallImage || !sameCorners(wallImage.corners, result.corners);
            setWallImage(result);
            setMode("wall");
            if (moved && visionUp !== false) {
              openings.clear();
              detectOpeningsOn(result);
            }
          }
        })
        .catch((error: unknown) => {
          if (session.current !== mine) return;
          setApplyError(t("photo.error.buildFailed", { detail: errorText(error, t) }));
        })
        .finally(() => {
          if (session.current === mine) setApplying(false);
        });
    }, 0);
  };

  const { detection, scanning } = job;
  const canApply = Boolean(photoSize && corners && wall.plane) && !applying && !scanning;
  const compassNote =
    photoUrl && compass !== undefined ? describeCompass(t, compass, wall.facing) : null;

  if (!presence.shown) return null;

  return (
    // The overlay uses the night tone, which stays dark in both themes.
    <div
      className={cx(
        "fixed inset-0 z-50 flex items-center justify-center bg-night/40 p-6 backdrop-blur-sm",
        presence.leaving ? "motion-fade-out" : "motion-fade-in",
      )}
    >
      <div
        ref={panel}
        className={cx(
          // One fixed width for every photo and both steps. A width taken from the image made
          // the columns resize, the toolbar wrap and the width change again, in a loop that
          // flashed between two layouts (kY). The stages fit the image inside instead.
          "flex h-full w-full flex-col overflow-hidden rounded-shell border border-line bg-paper shadow-float",
          presence.leaving ? "motion-float-out" : "motion-float-in",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={t("photo.title")}
      >
        {/* Header and notices take the dialog's width but never widen it. */}
        <div className="flex shrink-0 flex-col [contain:inline-size]">
          <EditorHeader
            mode={mode}
            wallText={describeWall(t, format.num, wall.plane, wall.groundZ, wall.buriedDepth)}
            fileInput={fileInput}
            onChoosePhoto={chooseFromDisk}
            showChoose={photoUrl !== null}
            onFileChosen={onFileChosen}
            showLoupe={mode === "photo" && photoSize !== null}
            loupeZoom={loupeZoom}
            onLoupeZoom={setLoupeZoom}
            showDetect={mode === "wall" && wallImage !== null && !detection}
            onDetect={runOpeningsOnly}
            applying={applying}
            canApply={canApply}
            onApply={apply}
            onBack={() => {
              setMode("photo");
            }}
            onClose={closeEditor}
            action={renderAction?.(openings.list, photoName, wallImage)}
            history={
              mode === "wall"
                ? {
                    canUndo: openings.canUndo,
                    canRedo: openings.canRedo,
                    onUndo: openings.undo,
                    onRedo: openings.redo,
                  }
                : null
            }
          />
          <EditorNotices
            aiOff={visionUp === false}
            compassNote={compassNote}
            baseHidden={baseHiddenNote}
          />
        </div>
        <div className="relative flex min-h-0 flex-1 gap-3 px-3 pb-3">
          <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto rounded-card bg-panel">
            <PhotoDetails exif={exif} photoSize={photoSize} hasPhoto={photoUrl !== null} />
            <Presence value={mode === "photo" ? corners : null}>
              {(corners) => (
                <CustomSection title={t("photo.corners")}>
                  <CornerTable corners={corners} />
                </CustomSection>
              )}
            </Presence>
          </aside>
          {mode === "wall" && wallImage && wall.plane ? (
            <WallColumn
              busy={scanning}
              toolbar={
                <OpeningsToolbar
                  // A new selection gets fresh fields, so a half-typed value cannot land on it.
                  key={openings.selected ?? "none"}
                  selected={openings.current}
                  onNew={openings.addDefault}
                  onDuplicate={openings.duplicateSelected}
                  onDelete={openings.deleteSelected}
                  onChange={(next, field) => {
                    if (openings.selected !== null)
                      openings.update(openings.selected, next, field && `field-${field}`);
                  }}
                />
              }
              footer={<SummaryStrip summary={openings.summary} />}
            >
              <WallStage
                view={wallView}
                outline={wall.plane.points}
                wallImage={wallImage}
                openings={openings.list}
                selected={openings.selected}
                onAdd={openings.add}
                onMove={openings.update}
                onSelect={openings.select}
                onDelete={openings.deleteSelected}
                onCopy={openings.copySelected}
                onPaste={openings.paste}
              />
              {scanning && <AiScan />}
            </WallColumn>
          ) : photoUrl ? (
            <StageFrame>
              <PhotoStage
                scanning={scanning}
                dotsProposed={dotsProposed}
                photoUrl={photoUrl}
                loupeUrl={working?.url ?? null}
                loupeZoom={loupeZoom}
                onLoupeZoom={setLoupeZoom}
                photoSize={photoSize}
                corners={corners}
                onPhotoLoaded={onPhotoLoaded}
                onPhotoError={onPhotoError}
                onCornersChange={(next) => {
                  setDotsProposed(false);
                  setCorners(next);
                }}
              />
            </StageFrame>
          ) : (
            <StageFrame>
              <PhotoEmptyState
                error={photoError}
                buildingGid={buildingGid}
                onChoose={chooseFromDisk}
                onSample={async (sample) => {
                  const mine = session.current;
                  const file = await sampleFile(sample);
                  // Closed, or another photo arrived while this one downloaded.
                  if (session.current === mine) loadPhoto(file);
                }}
              />
            </StageFrame>
          )}
          <EditorSideColumn
            mode={mode}
            detection={detection}
            onDismissDetection={() => {
              job.setDetection(null);
            }}
            onCancelDetection={job.cancel}
            working={working}
            corners={corners}
            wall={wall.plane}
            wallImage={wallImage}
            applyError={applyError}
            openings={openings}
            view={wallView}
            onView={setWallView}
            extra={renderSide?.(openings.list, photoName)}
          />
        </div>
      </div>
      <Presence show={askClose} kind="float">
        <CustomDialog
          title={t("photo.closeAsk.title")}
          closeLabel={t("photo.close")}
          onClose={() => {
            setAskClose(false);
          }}
        >
          <p className="text-sm text-ink">
            {t("photo.closeAsk.body", { n: openings.list.length })}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <CustomButton
              onClick={() => {
                setAskClose(false);
              }}
            >
              {t("photo.closeAsk.keep")}
            </CustomButton>
            <CustomButton variant="danger" onClick={discardAndClose}>
              {t("photo.closeAsk.discard")}
            </CustomButton>
          </div>
        </CustomDialog>
      </Presence>
    </div>
  );
}

/** The rounded frame the photo and the wall sit in, dark inside so photographs read true. */
function StageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-card">
      {children}
    </div>
  );
}

/**
 * The middle column on the wall: toolbar, stage and numbers. It takes the space the dialog
 * leaves and never sizes itself from the image; the stage fits the wall image inside.
 */
function WallColumn({
  busy,
  toolbar,
  footer,
  children,
}: {
  busy: boolean;
  toolbar: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cx("relative flex min-w-0 flex-1 flex-col", busy && "pointer-events-none")}>
      {toolbar}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-card">
        {children}
      </div>
      {footer}
    </div>
  );
}
