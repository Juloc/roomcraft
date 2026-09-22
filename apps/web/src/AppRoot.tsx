import { useEffect, useMemo, useState } from "react";
import { Button, TextField } from "@roomcraft/ui";
import { createEmptyProject } from "@roomcraft/document";
import { EditorApp } from "./App";
import { getAuthSession, login, logout, setupAdmin, type AuthSession } from "./auth-api";
import { adoptProject, ensureProject, listProjects, type ProjectSummary } from "./projects-api";
import { createEntityId } from "./random-id";

const CURRENT_PROJECT_KEY = "roomcraft.currentProjectId";

export function AppRoot() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    void getAuthSession()
      .then(setSession)
      .catch((error: unknown) =>
        setFatalError(error instanceof Error ? error.message : "RoomCraft could not start."),
      );
  }, []);

  if (fatalError) {
    return <main className="fatal-state"><strong>RoomCraft could not start</strong><span>{fatalError}</span></main>;
  }

  if (!session) {
    return <main className="fatal-state" aria-live="polite"><strong>Loading RoomCraft</strong><span>Checking your session.</span></main>;
  }

  if (session.setupRequired) {
    return <CredentialsScreen mode="setup" onAuthenticated={setSession} />;
  }

  if (!session.authenticated || !session.user) {
    return <CredentialsScreen mode="login" onAuthenticated={setSession} />;
  }

  if (activeProjectId) {
    return (
      <EditorApp
        projectId={activeProjectId}
        onExit={() => {
          setActiveProjectId(null);
        }}
      />
    );
  }

  return (
    <ProjectHome
      username={session.user.username}
      onOpen={(projectId) => {
        window.localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
        setActiveProjectId(projectId);
      }}
      onLogout={() => {
        void logout().then(async () => {
          setActiveProjectId(null);
          setSession(await getAuthSession());
        });
      }}
    />
  );
}

function CredentialsScreen({
  mode,
  onAuthenticated,
}: {
  mode: "setup" | "login";
  onAuthenticated(session: AuthSession): void;
}) {
  const [username, setUsername] = useState(mode === "setup" ? "admin" : "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const next =
        mode === "setup"
          ? await setupAdmin(username, password)
          : await login(username, password);
      onAuthenticated(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <strong>RoomCraft</strong>
          <span>{mode === "setup" ? "First-time setup" : "Sign in"}</span>
        </div>
        <p>
          {mode === "setup"
            ? "Create the first local administrator. Public registration stays disabled."
            : "Sign in to your self-hosted RoomCraft."}
        </p>
        <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" />
        <TextField
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
        />
        {error ? <div className="inline-error">{error}</div> : null}
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Please wait…" : mode === "setup" ? "Create administrator" : "Sign in"}
        </Button>
      </section>
    </main>
  );
}

function ProjectHome({
  username,
  onOpen,
  onLogout,
}: {
  username: string;
  onOpen(projectId: string): void;
  onLogout(): void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [newName, setNewName] = useState("My apartment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const legacyProjectId = useMemo(
    () => window.localStorage.getItem(CURRENT_PROJECT_KEY),
    [],
  );
  const canAdoptLegacy =
    legacyProjectId !== null &&
    projects !== null &&
    !projects.some((project) => project.id === legacyProjectId);

  async function refresh() {
    try {
      setProjects(await listProjects());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Projects could not be loaded.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createProject() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const document = createEmptyProject(createEntityId("project"), name);
      const created = await ensureProject(document);
      await refresh();
      onOpen(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Project could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function adoptLegacy() {
    if (!legacyProjectId) return;
    setBusy(true);
    setError(null);
    try {
      await adoptProject(legacyProjectId);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Local project could not be adopted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="project-home">
      <header className="project-home__header">
        <div>
          <strong>RoomCraft</strong>
          <span>{username}</span>
        </div>
        <Button variant="ghost" onClick={onLogout}>Sign out</Button>
      </header>

      <section className="project-home__content">
        <div className="project-home__intro">
          <div>
            <span className="eyebrow">Projects</span>
            <h1>Choose a project</h1>
            <p>Your plans are stored in this RoomCraft instance and linked to your account.</p>
          </div>
          <div className="project-create">
            <TextField label="New project name" value={newName} onChange={setNewName} />
            <Button variant="primary" disabled={busy} onClick={() => void createProject()}>
              New project
            </Button>
          </div>
        </div>

        {canAdoptLegacy ? (
          <div className="legacy-project">
            <div>
              <strong>Existing local project found</strong>
              <span>Attach the project from the pre-login RoomCraft version to this account.</span>
            </div>
            <Button disabled={busy} onClick={() => void adoptLegacy()}>Add to my account</Button>
          </div>
        ) : null}

        {error ? <div className="inline-error">{error}</div> : null}

        <div className="project-grid" aria-live="polite">
          {projects === null ? <span>Loading projects…</span> : null}
          {projects?.length === 0 ? <div className="project-empty">No projects yet. Create your first plan.</div> : null}
          {projects?.map((project) => (
            <button key={project.id} className="project-card" type="button" onClick={() => onOpen(project.id)}>
              <div className="project-card__preview" aria-hidden="true">⌂</div>
              <div className="project-card__body">
                <strong>{project.name}</strong>
                <span>Revision {project.revision}</span>
                <span>{new Date(project.updatedUtc).toLocaleString()}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
