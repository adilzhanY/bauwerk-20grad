import { Injectable } from "@nestjs/common";

/** One person in a project right now, as the Projects page shows them. */
export interface HereNow {
  userId: string;
  firstName: string;
  lastName: string;
  state: "here" | "away";
}

/**
 * Who has which project open right now, kept by the gateway (TODO Part 21, CC.4), so the
 * projects list can say "Lena is in it now" without asking the sockets. ponytail: in memory,
 * one server process; with several, presence needs a shared store (Redis or a table).
 */
@Injectable()
export class LiveProjects {
  private readonly tabs = new Map<string, Map<string, HereNow>>();

  set(projectId: string, socketId: string, person: HereNow) {
    let project = this.tabs.get(projectId);
    if (!project) {
      project = new Map();
      this.tabs.set(projectId, project);
    }
    project.set(socketId, person);
  }

  remove(projectId: string, socketId: string) {
    const project = this.tabs.get(projectId);
    if (!project) return;
    project.delete(socketId);
    if (project.size === 0) this.tabs.delete(projectId);
  }

  /** Each person once; here wins over away when they have several tabs. */
  here(projectId: string): HereNow[] {
    const people = new Map<string, HereNow>();
    for (const person of this.tabs.get(projectId)?.values() ?? []) {
      const known = people.get(person.userId);
      if (!known || (known.state === "away" && person.state === "here"))
        people.set(person.userId, person);
    }
    return [...people.values()];
  }

  /** Whether this person still has another tab of the project open. */
  stillIn(projectId: string, userId: string): boolean {
    for (const person of this.tabs.get(projectId)?.values() ?? [])
      if (person.userId === userId) return true;
    return false;
  }
}
