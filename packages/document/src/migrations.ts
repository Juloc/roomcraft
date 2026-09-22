import {
  CURRENT_SCHEMA_VERSION,
  type BlueprintReference,
  type ProjectDocument,
} from "./schema";
import { validateProjectDocument } from "./validation";

type CurrentLevel = ProjectDocument["levels"][number];
type LevelV3 = Omit<CurrentLevel, "floorThicknessMm">;

interface ProjectDocumentV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  settings: ProjectDocument["settings"];
  levels: Array<Omit<LevelV3, "blueprints">>;
}

type BlueprintReferenceV2 = Omit<BlueprintReference, "crop">;

interface ProjectDocumentV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  settings: ProjectDocument["settings"];
  levels: Array<
    Omit<LevelV3, "blueprints"> & {
      blueprints: BlueprintReferenceV2[];
    }
  >;
}

interface ProjectDocumentV3 {
  schemaVersion: 3;
  id: string;
  name: string;
  settings: ProjectDocument["settings"];
  levels: LevelV3[];
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
    return migrateV3ToV4(
      migrateV2ToV3(
        migrateV1ToV2(value as ProjectDocumentV1),
      ),
    );
  }

  if (schemaVersion === 2) {
    return migrateV3ToV4(
      migrateV2ToV3(value as ProjectDocumentV2),
    );
  }

  if (schemaVersion === 3) {
    return migrateV3ToV4(value as ProjectDocumentV3);
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

function migrateV1ToV2(document: ProjectDocumentV1): ProjectDocumentV2 {
  return {
    ...document,
    schemaVersion: 2,
    levels: document.levels.map((level) => ({
      ...level,
      blueprints: [],
    })),
  };
}

function migrateV2ToV3(document: ProjectDocumentV2): ProjectDocumentV3 {
  return {
    ...document,
    schemaVersion: 3,
    levels: document.levels.map((level) => ({
      ...level,
      blueprints: level.blueprints.map((blueprint) => ({
        ...blueprint,
        crop: {
          leftPx: 0,
          topPx: 0,
          widthPx: blueprint.sourceWidthPx,
          heightPx: blueprint.sourceHeightPx,
        },
      })),
    })),
  };
}

function migrateV3ToV4(document: ProjectDocumentV3): ProjectDocument {
  return {
    ...document,
    schemaVersion: 4,
    levels: document.levels.map((level) => ({
      ...level,
      floorThicknessMm: 200,
    })),
  };
}
