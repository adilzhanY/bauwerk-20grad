/**
 * Where a project opens, and how a new project travels from the dialog to the building page.
 *
 * A project opens at its first step not yet done: the survey (the building page) while no
 * facade has been photographed, then the model, the variants, the report. A new project is
 * carried in the address (`?neu=1&kunde=...`) so it survives the way through the map and a
 * reload; the building page creates the project once the building's data is there.
 */
import type { Route } from "@/app/router";
import type { ProjectSummary } from "@/geometry/project";

/** The page a project opens at. */
export function landingRoute(summary: ProjectSummary): Route {
  const [survey, model, variants] = summary.steps;
  if (summary.stage === "done") return { page: "editor" };
  if (!survey && summary.gid) return { page: "building", gid: summary.gid };
  if (!model || !variants) return { page: model ? "variants" : "editor" };
  return { page: "report" };
}

export interface NewProjectRequest {
  name: string;
  client: string;
}

/** The query string that asks the building page to start a new project. */
export function newProjectQuery(request: NewProjectRequest): string {
  const params = new URLSearchParams({ neu: "1" });
  if (request.name.trim()) params.set("name", request.name.trim());
  if (request.client.trim()) params.set("kunde", request.client.trim());
  return `?${params.toString()}`;
}

/** The new project a query string asks for, or null. */
export function readNewProject(search: string): NewProjectRequest | null {
  const params = new URLSearchParams(search);
  if (params.get("neu") !== "1") return null;
  return { name: params.get("name") ?? "", client: params.get("kunde") ?? "" };
}
