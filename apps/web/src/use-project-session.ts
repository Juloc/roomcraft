import type { ProjectDocument } from "@roomcraft/document";
import { CommandHistory, type EditorCommand } from "@roomcraft/editor-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectConflictError, ensureProject, saveProject } from "./projects-api";

export type SaveState = "loading" | "saved" | "unsaved" | "saving" | "conflict" | "error";

export interface ProjectSession {
  document: ProjectDocument;
  revision: number | null;
  saveState: SaveState;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  execute(command: EditorCommand): ProjectDocument;
  undo(): ProjectDocument;
  redo(): ProjectDocument;
  importDocument(document: ProjectDocument): void;
  saveNow(): Promise<void>;
}

export function useProjectSession(createInitialDocument: () => ProjectDocument): ProjectSession {
  const initialDocumentRef = useRef<ProjectDocument | null>(null);
  if (!initialDocumentRef.current) initialDocumentRef.current = createInitialDocument();

  const historyRef = useRef<CommandHistory | null>(null);
  if (!historyRef.current) historyRef.current = new CommandHistory(initialDocumentRef.current);

  const documentRef = useRef(historyRef.current.document);
  const revisionRef = useRef<number | null>(null);
  const saveStateRef = useRef<SaveState>("loading");
  const editVersionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const [document, setDocument] = useState(documentRef.current);
  const [revision, setRevision] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [saveError, setSaveError] = useState<string | null>(null);

  const setRevisionValue = useCallback((value: number | null) => {
    revisionRef.current = value;
    setRevision(value);
  }, []);

  const setSaveStateValue = useCallback((value: SaveState) => {
    saveStateRef.current = value;
    setSaveState(value);
  }, []);

  const replaceDocument = useCallback((value: ProjectDocument, dirty: boolean) => {
    documentRef.current = value;
    setDocument(value);
    if (dirty) {
      editVersionRef.current += 1;
      setSaveError(null);
      setSaveStateValue("unsaved");
    }
  }, [setSaveStateValue]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const initialDocument = initialDocumentRef.current;
    if (!initialDocument) return;
    const hydrationDocument: ProjectDocument = initialDocument;

    async function hydrate() {
      try {
        const persisted = await ensureProject(hydrationDocument);
        if (cancelled || !mountedRef.current) return;

        const history = new CommandHistory(persisted.document);
        historyRef.current = history;
        documentRef.current = persisted.document;
        setDocument(persisted.document);
        setRevisionValue(persisted.revision);
        setSaveError(null);
        setSaveStateValue("saved");
      } catch (error) {
        if (cancelled || !mountedRef.current) return;
        setSaveError(errorMessage(error));
        setSaveStateValue("error");
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [setRevisionValue, setSaveStateValue]);

  const saveNow = useCallback(async () => {
    if (saveInFlightRef.current || saveStateRef.current === "loading") return;

    const snapshot = documentRef.current;
    const startedEditVersion = editVersionRef.current;
    saveInFlightRef.current = true;
    setSaveError(null);
    setSaveStateValue("saving");

    try {
      let currentRevision = revisionRef.current;
      if (currentRevision === null) {
        const persisted = await ensureProject(snapshot);
        currentRevision = persisted.revision;
        setRevisionValue(currentRevision);

        if (persisted.document !== snapshot && startedEditVersion === 0) {
          historyRef.current = new CommandHistory(persisted.document);
          documentRef.current = persisted.document;
          setDocument(persisted.document);
        }
      }

      const documentToSave = documentRef.current;
      if (documentToSave !== snapshot && startedEditVersion === 0) {
        setSaveStateValue("saved");
        return;
      }

      const persisted = await saveProject(snapshot, currentRevision);
      if (!mountedRef.current) return;
      setRevisionValue(persisted.revision);

      if (editVersionRef.current === startedEditVersion) {
        setSaveStateValue("saved");
      } else {
        setSaveStateValue("unsaved");
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setSaveError(errorMessage(error));
      setSaveStateValue(error instanceof ProjectConflictError ? "conflict" : "error");
    } finally {
      saveInFlightRef.current = false;
    }
  }, [setRevisionValue, setSaveStateValue]);

  useEffect(() => {
    if (saveState !== "unsaved") return;
    const timer = window.setTimeout(() => void saveNow(), 900);
    return () => window.clearTimeout(timer);
  }, [document, revision, saveNow, saveState]);

  const execute = useCallback((command: EditorCommand): ProjectDocument => {
    const history = requireHistory(historyRef);
    const next = history.execute(command);
    replaceDocument(next, true);
    return next;
  }, [replaceDocument]);

  const undo = useCallback((): ProjectDocument => {
    const history = requireHistory(historyRef);
    if (!history.canUndo) return history.document;
    const next = history.undo();
    replaceDocument(next, true);
    return next;
  }, [replaceDocument]);

  const redo = useCallback((): ProjectDocument => {
    const history = requireHistory(historyRef);
    if (!history.canRedo) return history.document;
    const next = history.redo();
    replaceDocument(next, true);
    return next;
  }, [replaceDocument]);

  const importDocument = useCallback((value: ProjectDocument): void => {
    const history = new CommandHistory(value);
    historyRef.current = history;
    documentRef.current = value;
    setDocument(value);
    setRevisionValue(null);
    editVersionRef.current += 1;
    setSaveError(null);
    setSaveStateValue("unsaved");
  }, [setRevisionValue, setSaveStateValue]);

  const history = requireHistory(historyRef);
  return {
    document,
    revision,
    saveState,
    saveError,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    execute,
    undo,
    redo,
    importDocument,
    saveNow,
  };
}

function requireHistory(ref: { current: CommandHistory | null }): CommandHistory {
  const history = ref.current;
  if (!history) throw new Error("Project command history is unavailable.");
  return history;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
