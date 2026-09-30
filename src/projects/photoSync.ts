/**
 * Keeps the editor's pictures with the open project: the facade photo on each wall (slot "0",
 * "1", ...) and the floor plan image each storey was read from (slot "plan-<storey id>").
 *
 * Before a project is saved its pictures live in this tab only. The first Save uploads every
 * one of them into the new project, and from then on each new picture goes up as it is put
 * on; opening a project brings its pictures back. Removing a photo from a wall is done where
 * the user removes it (RightPanel), never here: a new building clears the pictures too, and
 * that must not delete them from the project it came from.
 */
import type { createEditorStore, FacadePhoto } from "@/store/building";
import { photoSlots, projectRefOf, photoUrl, sameRef, savePhoto, shrinkImage } from "./projects";
import type { ProjectRef } from "./projects";

type Store = ReturnType<typeof createEditorStore>;

const PLAN_SLOT = "plan-";

export function startPhotoSync(store: Store): () => void {
  // Picture URLs that came from the project or went to it: nothing to upload for those.
  const known = new Set<string>();
  let open: ProjectRef | null = null;

  const loadInto = async (ref: ProjectRef) => {
    for (const { slot, width, height } of await photoSlots(ref)) {
      const edge = /^\d+$/.test(slot) ? Number(slot) : null;
      const storeyId = slot.startsWith(PLAN_SLOT) ? slot.slice(PLAN_SLOT.length) : null;
      if (edge === null && storeyId === null) continue;
      const state = store.getState();
      if (edge !== null && state.facadePhotos[edge]) continue;
      if (storeyId !== null && state.floorPlanImages[storeyId]) continue;
      const url = await photoUrl(ref, slot);
      if (!url) continue;
      // The project may have changed while the picture was on its way.
      if (!sameRef(projectRefOf(store.getState()), ref)) {
        URL.revokeObjectURL(url);
        return;
      }
      known.add(url);
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

  const uploadNew = (ref: ProjectRef, state: ReturnType<Store["getState"]>) => {
    for (const { slot, photo, card } of pictures(state)) {
      if (known.has(photo.url)) continue;
      known.add(photo.url);
      void upload(ref, slot, photo, card).catch(() => {
        // Offline or refused: the picture stays in this tab and goes up with the next change.
        known.delete(photo.url);
      });
    }
  };

  return store.subscribe((state, previous) => {
    const ref = projectRefOf(state);
    if (!sameRef(ref, open)) {
      open = ref;
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
}
