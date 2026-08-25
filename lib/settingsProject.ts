// Which project the Settings screen should open on (VSK-28).
//
// The bug: Settings defaulted to `projects[0]` (ordered createdAt desc = the
// newest project, GAN), so a user working on VSK saw GAN's labels and concluded
// their labels were lost. The fix is to let the caller request a project (via
// `/settings?project=<id>` or a "Manage labels" link that carries the ticket's
// projectId) and honour it when it is valid, falling back to the first project
// only when no valid project was requested.
//
// Kept as a pure, isomorphic helper so the selection rule is unit-testable under
// the repo's node-only vitest and is the single source of truth for both the
// server page and the client component.

export function resolveInitialProject(
  projects: { id: string }[],
  requestedId?: string | null
): string {
  if (requestedId && projects.some((p) => p.id === requestedId)) {
    return requestedId;
  }
  return projects[0]?.id ?? "";
}
