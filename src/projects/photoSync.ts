/**
 * Keeps the editor's pictures with the open project: the facade photo on each wall (slot "0",
 * "1", ...) and the floor plan image each storey was read from (slot "plan-<storey id>").
 *
 * Before a project is saved its pictures live in this tab only. The first Save uploads every
 * one of them into the new project, and from then on each new picture goes up as it is put
 * on; opening a project brings its pictures back. Removing a photo from a wall is done where
 * the user removes it (RightPanel), not here: a new building clears the pictures too, and
 * that must not delete them from the project it came from. The one removal here is a photo
 * that moved to another wall number (a footprint edit): its old slot goes once it is stored
 * under the new one.
 */
import type { createEditorStore, FacadePhoto } from "@/store/building";
import {
  photoSlots,
  projectRefOf,
  photoUrl,
  removePhoto,
  sameRef,
  savePhoto,
  shrinkImage,
} from "./projects";
import type { ProjectRef } from "./projects";
import { FILES_EVENT } from "./files";

type Store = ReturnType<typeof createEditorStore>;

const PLAN_SLOT = "plan-";
/** After a failed upload, the next try waits this long (offline, or the server restarting). */
export const PHOTO_RETRY_MS = 30_000;

export function startPhotoSync(store: Store): () => void {
  // Picture URLs that came from the project or went to it, with the slot they are stored in:
  // nothing to upload for those, unless the picture moved to another slot (a wall renumbered
  // by a footprint edit), when it is stored under its new slot and the old one is removed.
  const slotOf = new Map<string, string>();
  let open: ProjectRef | null = null;
  // When each slot's picture in the project was put there, as last read. A slot that was
  // there and is gone was removed (by anyone); a new time means it was replaced. A picture
  // this tab holds that was never seen there is one not uploaded yet, and stays.
  let seen = new Map<string, string>();

  /**
   * Brings the project's pictures into the editor: the missing ones, and with `follow` the
   * ones replaced or removed since the last read (the server said the files changed).
   */
  const loadInto = async (ref: ProjectRef, follow = false) => {
    const slots = await photoSlots(ref);
    if (!sameRef(projectRefOf(store.getState()), ref)) return;
    const before = seen;
    seen = new Map(slots.map((s) => [s.slot, s.updatedAt ?? ""]));
    if (follow) {
      const state = store.getState();
      for (const edge of Object.keys(state.facadePhotos)) {
        if (before.has(edge) && !seen.has(edge)) state.setFacadePhoto(Number(edge), null);
      }
      for (const storeyId of Object.keys(state.floorPlanImages)) {
        const slot = PLAN_SLOT + storeyId;
        if (before.has(slot) && !seen.has(slot)) state.setFloorPlanImage(storeyId, null);
      }
    }
    for (const { slot, width, height, updatedAt } of slots) {
      const edge = /^\d+$/.test(slot) ? Number(slot) : null;
      const storeyId = slot.startsWith(PLAN_SLOT) ? slot.slice(PLAN_SLOT.length) : null;
      if (edge === null && storeyId === null) continue;
      const replaced = follow && before.has(slot) && before.get(slot) !== (updatedAt ?? "");
      const state = store.getState();
      if (!replaced && edge !== null && state.facadePhotos[edge]) continue;
      if (!replaced && storeyId !== null && state.floorPlanImages[storeyId]) continue;
      const url = await photoUrl(ref, slot);
      if (!url) continue;
      // The project may have changed while the picture was on its way.
      if (!sameRef(projectRefOf(store.getState()), ref)) {
        URL.revokeObjectURL(url);
        return;
      }
      slotOf.set(url, slot);
      if (edge !== null) store.getState().setFacadePhoto(edge, { url, width, height });
      else if (storeyId !== null)
        store.getState().setFloorPlanImage(storeyId, { url, width, height });
    }
  };

  const upload = async (ref: ProjectRef, slot: string, photo: FacadePhoto, card: boolean) => {
    const blob = await (await fetch(photo.url)).blob();
    await savePhoto(ref, slot, blob, photo.width, photo.height);
    if (!card) return;
    const small = await shrinkImage(blob);
    if (small) await savePhoto(ref, "thumbnail", small.blob, small.width, small.height);
  };

  /** Every picture of the editor as its slot, facade photos first (they make the card picture). */
  const pictures = (state: ReturnType<Store["getState"]>) => [
    ...Object.entries(state.facadePhotos).map(([edge, photo]) => ({
      slot: edge,
      photo,
      card: true,
    })),
    ...Object.entries(state.floorPlanImages).map(([id, photo]) => ({
      slot: PLAN_SLOT + id,
      photo,
      card: false,
    })),
  ];

  let retry: ReturnType<typeof setTimeout> | null = null;

  const uploadNew = (ref: ProjectRef, state: ReturnType<Store["getState"]>) => {
    const wanted = new Set<string>();
    const moves: Promise<boolean>[] = [];
    const left: string[] = [];
    for (const { slot, photo, card } of pictures(state)) {
      wanted.add(slot);
      const stored = slotOf.get(photo.url);
      if (stored === slot) continue;
      if (stored !== undefined) left.push(stored);
      slotOf.set(photo.url, slot);
      const sent = upload(ref, slot, photo, card).then(
        () => true,
        (error: unknown) => {
          // Offline or refused: the picture stays in this tab and goes up with the next
          // change, or on the next try after a pause.
          if (stored === undefined) slotOf.delete(photo.url);
          else slotOf.set(photo.url, stored);
          console.warn("A picture was not saved, trying again:", error);
          retry ??= setTimeout(() => {
            retry = null;
            if (sameRef(open, ref)) uploadNew(ref, store.getState());
          }, PHOTO_RETRY_MS);
          return false;
        },
      );
      if (stored !== undefined) moves.push(sent);
    }
    // Once every moved picture is stored again, the slots nothing holds any more go. A slot a
    // moved picture took over is still wanted and stays; a move that failed keeps its old one.
    const gone = left.filter((slot) => !wanted.has(slot));
    if (gone.length > 0) {
      void Promise.all(moves).then(async (done) => {
        if (!done.every(Boolean)) return;
        for (const slot of gone) await removePhoto(ref, slot).catch(() => undefined);
      });
    }
  };

  // The server said the files changed, from this tab or another person's.
  const onFiles = () => {
    if (open) void loadInto(open, true);
  };
  window.addEventListener(FILES_EVENT, onFiles);

  const unsubscribe = store.subscribe((state, previous) => {
    const ref = projectRefOf(state);
    if (!sameRef(ref, open)) {
      open = ref;
      seen = new Map();
      if (!ref) return;
      // Just saved: what was made before the Save goes up now. Just opened: the editor holds
      // no pictures yet, and the project's own come down.
      uploadNew(ref, state);
      void loadInto(ref);
      return;
    }
    if (!ref) return;
    if (
      state.facadePhotos !== previous.facadePhotos ||
      state.floorPlanImages !== previous.floorPlanImages
    )
      uploadNew(ref, state);
  });
  return () => {
    unsubscribe();
    if (retry) clearTimeout(retry);
    window.removeEventListener(FILES_EVENT, onFiles);
  };
}
