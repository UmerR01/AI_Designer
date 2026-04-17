export const DESIGNER_PROJECTS_KEY = "designer.projects.v1";

export type ProjectKind =
  | "website design"
  | "ui/ux design"
  | "logo design"
  | "campaign design"
  | "practice";

export type DesignerProject = {
  id: string;
  name: string;
  sizeText: string;
  dateText: string;
  /** Set when creating from Projects flow; older projects may omit */
  kind?: ProjectKind;
};

export function formatProjectDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

export function readDesignerProjects(): DesignerProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DESIGNER_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as DesignerProject[];
  } catch {
    return [];
  }
}

export function writeDesignerProjects(projects: DesignerProject[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DESIGNER_PROJECTS_KEY, JSON.stringify(projects));
}

export function makeDesignerProject(name: string, kind?: ProjectKind | null): DesignerProject {
  return {
    id: crypto.randomUUID(),
    name,
    sizeText: "0 GB",
    dateText: formatProjectDate(new Date()),
    ...(kind ? { kind } : {}),
  };
}
