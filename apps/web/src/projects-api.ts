import { validateProjectDocument, type ProjectDocument } from "@roomcraft/document";

export interface PersistedProject {
  id: string;
  name: string;
  revision: number;
  updatedUtc: string;
  document: ProjectDocument;
}

export async function loadProject(projectId: string): Promise<PersistedProject | null> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Loading project failed with HTTP ${response.status}.`);
  return parseProjectResponse(await response.json());
}

export async function createProject(document: ProjectDocument): Promise<PersistedProject> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document }),
  });
  if (!response.ok) throw new Error(`Creating project failed with HTTP ${response.status}.`);
  return parseProjectResponse(await response.json());
}

export async function saveProject(
  document: ProjectDocument,
  revision: number,
): Promise<PersistedProject> {
  const response = await fetch(`/api/projects/${encodeURIComponent(document.id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": String(revision),
    },
    body: JSON.stringify({ document }),
  });

  if (response.status === 409) {
    throw new ProjectConflictError("The project was changed by another session.");
  }
  if (!response.ok) throw new Error(`Saving project failed with HTTP ${response.status}.`);
  return parseProjectResponse(await response.json());
}

export class ProjectConflictError extends Error {}

function parseProjectResponse(value: unknown): PersistedProject {
  if (!value || typeof value !== "object") throw new Error("Invalid project response.");
  const response = value as Record<string, unknown>;
  const document = response.document as ProjectDocument;
  validateProjectDocument(document);

  if (typeof response.id !== "string" || response.id !== document.id) {
    throw new Error("Project response id does not match its document.");
  }
  if (typeof response.name !== "string") throw new Error("Project response name is invalid.");
  if (!Number.isSafeInteger(response.revision) || (response.revision as number) <= 0) {
    throw new Error("Project response revision is invalid.");
  }
  if (typeof response.updatedUtc !== "string") {
    throw new Error("Project response updatedUtc is invalid.");
  }

  return {
    id: response.id,
    name: response.name,
    revision: response.revision as number,
    updatedUtc: response.updatedUtc,
    document,
  };
}
