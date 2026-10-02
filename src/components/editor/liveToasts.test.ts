import { describe, expect, it } from "vitest";
import { translate } from "@/i18n";
import type { MessageKey, Params } from "@/i18n";
import { exampleHouse } from "@/lib/examples";
import type { Notice } from "@/projects/collab";
import { MAX_TOASTS, activityToast, mentionToast, pushToast } from "./liveToasts";
import { selectionOfTarget, targetLabel } from "./noteTarget";

const en = (key: MessageKey, params?: Params) => translate("en", key, params);
const de = (key: MessageKey, params?: Params) => translate("de", key, params);
const house = exampleHouse("en");
const ground = house.storeys[0]!;
const room = ground.rooms[0]!;

const notice = (over: Partial<Notice>): Notice => ({
  id: "n1",
  kind: "mentioned",
  projectId: "p1",
  projectName: "House",
  actor: { id: "u-anna", firstName: "Anna", lastName: "Becker", username: "anna_pc1" },
  payload: {
    threadId: "t1",
    text: "add walls here",
    target: { kind: "room", storeyId: ground.id, id: room.id },
  },
  count: 1,
  createdAt: "2026-10-02T10:00:00Z",
  readAt: null,
  ...over,
});

describe("mention toasts", () => {
  it("say who mentioned this person and where, in English and German", () => {
    const toast = mentionToast(notice({}), "p1", house, en);
    expect(toast?.text).toBe(`Anna Becker mentioned you on ${ground.name}, ${room.name}`);
    expect(toast?.detail).toBe("add walls here");
    expect(toast?.jump).toEqual({ target: { kind: "room", storeyId: ground.id, id: room.id } });
    const german = mentionToast(
      notice({ payload: { text: "x", target: { kind: "building" } } }),
      "p1",
      house,
      de,
    );
    expect(german?.text).toBe("Anna Becker hat Sie beim Gebäude erwähnt");
  });

  it("only for a new mention in the project that is open", () => {
    expect(mentionToast(notice({ projectId: "other" }), "p1", house, en)).toBeNull();
    expect(mentionToast(notice({ kind: "replied" }), "p1", house, en)).toBeNull();
    expect(mentionToast(notice({ readAt: "2026-10-02T10:01:00Z" }), "p1", house, en)).toBeNull();
    expect(mentionToast(notice({}), null, house, en)).toBeNull();
  });
});

describe("activity toasts", () => {
  it("name the person and the storey, wall or version", () => {
    const plan = activityToast(
      {
        actor: "Ben Keller",
        userId: "u-ben",
        activity: { kind: "floorPlan", storeyId: ground.id },
      },
      house,
      en,
    );
    expect(plan?.text).toBe(`Ben Keller applied a floor plan to ${ground.name}`);
    const facade = activityToast(
      {
        actor: "Ben Keller",
        userId: "u-ben",
        activity: { kind: "facade", wallIndex: 2, count: 24 },
      },
      house,
      de,
    );
    expect(facade?.text).toBe("Ben Keller hat 24 Öffnungen aus einem Foto auf Wand 3 gesetzt");
    expect(
      activityToast(
        { actor: "Ben", userId: null, activity: { kind: "restore", version: 8 } },
        house,
        en,
      )?.text,
    ).toBe("Ben restored version 8");
    // A storey that is gone meanwhile says nothing.
    expect(
      activityToast(
        { actor: "Ben", userId: null, activity: { kind: "floorPlan", storeyId: "gone" } },
        house,
        en,
      ),
    ).toBeNull();
  });
});

describe("the toast list", () => {
  it("keeps one per key, newest on top, and at most a few", () => {
    let list = pushToast([], { key: "a", n: 1 });
    list = pushToast(list, { key: "b", n: 1 });
    list = pushToast(list, { key: "a", n: 2 });
    expect(list).toEqual([
      { key: "a", n: 2 },
      { key: "b", n: 1 },
    ]);
    for (const key of ["c", "d", "e"]) list = pushToast(list, { key, n: 1 });
    expect(list).toHaveLength(MAX_TOASTS);
    expect(list[0]?.key).toBe("e");
  });
});

describe("note targets", () => {
  it("are named as the element tree names them", () => {
    const window1 = ground.openings.find((o) => o.kind === "window")!;
    expect(targetLabel(house, { kind: "wall", wallIndex: 0 }, en)).toBe("Wall 1");
    expect(targetLabel(house, { kind: "opening", storeyId: ground.id, id: window1.id }, en)).toBe(
      `${ground.name}, Window 1`,
    );
    expect(targetLabel(house, { kind: "building" }, en)).toBeNull();
    expect(targetLabel(house, { kind: "room", storeyId: ground.id, id: "gone" }, en)).toBeNull();
  });

  it("lead back to the element to select, on its storey", () => {
    expect(
      selectionOfTarget(house, { kind: "room", storeyId: ground.id, id: room.id }, null),
    ).toEqual({
      selection: { kind: "room", storeyId: ground.id, id: room.id },
      storeyId: ground.id,
    });
    expect(selectionOfTarget(house, { kind: "wall", wallIndex: 1 }, ground.id)?.selection).toEqual({
      kind: "wall",
      storeyId: ground.id,
      wallIndex: 1,
    });
    expect(selectionOfTarget(house, { kind: "building" }, null)).toBeNull();
  });
});
