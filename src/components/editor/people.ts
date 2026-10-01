import type { Presence as Tab } from "@/store/building";

/** One person in the project: their tabs together, here if any tab is. */
interface Person {
  key: string;
  userId: string;
  firstName: string;
  lastName: string;
  state: "here" | "away";
  /** The tab to follow and to read the page and storey from: a tab that is here, if any. */
  tab: Tab;
  tabs: number;
}

export function people(tabs: readonly Tab[]): Person[] {
  const byPerson = new Map<string, Person>();
  for (const tab of tabs) {
    const key = tab.userId ?? tab.clientId;
    const state = tab.state ?? "here";
    const [first = tab.actor, ...rest] = tab.actor.split(" ");
    const known = byPerson.get(key);
    if (!known) {
      byPerson.set(key, {
        key,
        userId: tab.userId ?? tab.clientId,
        firstName: tab.firstName ?? first,
        lastName: tab.lastName ?? rest.join(" "),
        state,
        tab,
        tabs: 1,
      });
      continue;
    }
    known.tabs += 1;
    if (known.state === "away" && state === "here") {
      known.state = "here";
      known.tab = tab;
    }
  }
  return [...byPerson.values()].sort((a, b) =>
    a.state === b.state ? 0 : a.state === "here" ? -1 : 1,
  );
}
