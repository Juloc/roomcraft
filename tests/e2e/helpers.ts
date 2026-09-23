import { expect, type Page } from "@playwright/test";

export const E2E_USERNAME = "e2e-admin";
export const E2E_PASSWORD = "roomcraft-e2e-password";

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");

  const setupButton = page.getByRole("button", { name: "Create administrator" });
  const loginButton = page.getByRole("button", { name: "Sign in", exact: true });

  await expect(setupButton.or(loginButton)).toBeVisible();

  if (await setupButton.isVisible()) {
    await page.getByRole("textbox", { name: "Username" }).fill(E2E_USERNAME);
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await setupButton.click();
  } else {
    await page.getByRole("textbox", { name: "Username" }).fill(E2E_USERNAME);
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await loginButton.click();
  }

  await expect(page.getByRole("heading", { name: "Choose a project" })).toBeVisible();
}

export async function createProject(page: Page, name: string): Promise<string> {
  await page.getByRole("textbox", { name: "New project name" }).fill(name);
  await page.getByRole("button", { name: "New project" }).click();

  const plan = page.getByRole("application", { name: "2D floor plan editor" });
  await expect(plan).toBeVisible();
  await expect(page.locator(".save-state:visible")).toHaveText("Saved");

  const projects = await page.evaluate(async () => {
    const response = await fetch("/api/projects");
    if (!response.ok) throw new Error(`Project list failed with ${response.status}`);
    return (await response.json()) as Array<{ id: string; name: string }>;
  });

  const project = projects.find((candidate) => candidate.name === name);
  if (!project) throw new Error(`Project ${name} was not found after creation.`);
  return project.id;
}

export function statValue(page: Page, label: string) {
  return page
    .locator("dl.stats > div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd");
}

export async function requireBox(locator: ReturnType<Page["getByRole"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Plan canvas does not have a bounding box.");
  return box;
}

export function desktopTool(page: Page, name: string) {
  return page.locator(".tool-rail").getByRole("button", { name, exact: true });
}

export async function openDesktopProjectMenu(page: Page) {
  const menu = page.locator(".desktop-project-menu");
  if ((await menu.getAttribute("open")) === null) {
    await menu.locator(".rc-menu__trigger").click();
  }
  return menu;
}
