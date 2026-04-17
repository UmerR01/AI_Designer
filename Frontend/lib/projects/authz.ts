import { sql } from "@/lib/db";

export type ProjectRole = "owner" | "editor" | "viewer";

export function canRead(role: ProjectRole) {
  return role === "owner" || role === "editor" || role === "viewer";
}

export function canWrite(role: ProjectRole) {
  return role === "owner" || role === "editor";
}

export async function getUserRoleForProject(userId: string, projectId: string): Promise<ProjectRole | null> {
  const rows = await sql()<{ role: ProjectRole }>`
    select
      case
        when p.owner_id = ${userId} then 'owner'
        else m.role
      end as role
    from projects p
    left join project_members m
      on m.project_id = p.id
     and m.user_id = ${userId}
    where p.id = ${projectId}
    limit 1
  `;
  return rows[0]?.role ?? null;
}

