import { CURRENT_SCHEMA_VERSION, type ProjectDocument } from "./schema";
import { validateProjectDocument } from "./validation";

interface ProjectDocumentV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  settings: ProjectDocument["settings"];
  levels: Array<Omit<ProjectDocument["levels"][number], "blueprints">>;
}

export function migrateProjectDocument(value: unknown): ProjectDocument {
  if (!value || typeof value !== "object") {
    throw new Error("Project document must be an object.");
  }

  const source = value as Record<string, unknown>;
  const schemaVersion = source.schemaVersion;

  if (schemaVersion === CURRENT_SCHEMA_VERSION) {
    return value as ProjectDocument;
  }

  if (schemaVersion === 1) {
    return migrateV1ToV2(value as ProjectDocumentV1);
  }

  if (typeof schemaVersion === "number" && schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Project schema version ${schemaVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}.`,
    );
  }

  throw new Error(`Unsupported project schema version: ${String(schemaVersion)}.`);
}

export function parseProjectDocument(value: unknown): ProjectDocument {
  const migrated = migrateProjectDocument(value);
  validateProjectDocument(migrated);
  return migrated;
}

function migrateV1ToV2(document: ProjectDocumentV1): ProjectDocument {
  return {
    ...document,
    schemaVersion: 2,
    levels: document.levels.map((level) => ({
      ...level,
      blueprints: [],
    })),
  };
}
