import { expect, test, type Locator, type Page } from "@playwright/test";

const ADMIN_USERNAME = "e2e-admin";
const ADMIN_PASSWORD = "roomcraft-e2e-password";
const PROJECT_NAME = "E2E apartment";

test("sets up RoomCraft and protects the complete planning flow", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("First-time setup", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Username", exact: true }).fill(ADMIN_USERNAME);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Create administrator", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Choose a project" })).toBeVisible();
  await page.getByRole("textbox", { name: "New project name", exact: true }).fill(PROJECT_NAME);
  await page.getByRole("button", { name: "New project", exact: true }).click();

  await expect(page.locator(".save-state")).toHaveText("Saved");
  const plan = page.getByRole("application", {
    name: "2D floor plan editor",
  });
  await expect(plan).toBeVisible();

  const projectsResponse = await page.request.get("/api/projects");
  expect(projectsResponse.ok()).toBeTruthy();
  const projects = (await projectsResponse.json()) as Array<{
    id: string;
    name: string;
  }>;
  const project = projects.find((candidate) => candidate.name === PROJECT_NAME);
  expect(project).toBeTruthy();
  const projectId = project!.id;

  await importAndCalibrateBlueprint(page, plan);
  await drawClosedRoom(page, plan);

  await expect(statValue(page, "Rooms")).toHaveText("1");
  await expect(statValue(page, "Walls")).toHaveText("4");

  const box = await requireBox(plan);
  const firstWall = plan.locator(".plan-wall-hit").first();

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await firstWall.click();

  const wallPanel = page
    .locator(".selection-properties")
    .filter({ hasText: "Selected wall" });
  const length = wallPanel.getByRole("textbox", { name: /Length/ });
  await expect(length).toBeVisible();
  await length.fill("2500 mm");
  await length.press("Enter");
  await expect(length).toHaveValue("2500 mm");

  await page.getByRole("button", { name: "Door", exact: true }).click();
  await firstWall.click();
  await expect(statValue(page, "Openings")).toHaveText("1");

  await page.getByRole("button", { name: "Furniture", exact: true }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await plan.click({
    position: {
      x: box.width * 0.54,
      y: box.height * 0.44,
    },
  });

  const tablePanel = page
    .locator(".selection-properties")
    .filter({ hasText: "Selected Table" });
  const furnitureWidth = tablePanel.getByRole("textbox", { name: /Width/ });
  await expect(furnitureWidth).toBeVisible();
  await furnitureWidth.fill("1800 mm");
  await furnitureWidth.press("Enter");
  await expect(furnitureWidth).toHaveValue("1800 mm");

  await page.getByRole("button", { name: "New cabinet", exact: true }).click();
  await plan.click({
    position: {
      x: box.width * 0.4,
      y: box.height * 0.44,
    },
  });

  await expect(page.getByText("Cabinet construction", { exact: true })).toBeVisible();
  await expect(page.getByText("Cut list", { exact: true })).toBeVisible();

  const cabinetBuilder = page.locator(".cabinet-builder");
  const shelves = cabinetBuilder.getByRole("textbox", { name: /Shelves/ });
  await shelves.fill("4");
  await shelves.press("Enter");

  await expect(page.locator(".save-state")).toHaveText("Saved");

  const persisted = await page.request.get(
    `/api/projects/${encodeURIComponent(projectId)}`,
  );
  expect(persisted.ok()).toBeTruthy();
  const persistedProject = await persisted.json();
  expect(persistedProject.document.levels[0].walls).toHaveLength(4);
  expect(persistedProject.document.levels[0].openings).toHaveLength(1);
  expect(persistedProject.document.levels[0].objects).toHaveLength(2);
  expect(
    persistedProject.document.levels[0].objects.some(
      (object: { assetId: string; widthMm: number }) =>
        object.assetId === "builtin:table" && object.widthMm === 1800,
    ),
  ).toBe(true);
  expect(persistedProject.document.levels[0].blueprints).toHaveLength(1);
  expect(persistedProject.document.parametricAssets).toHaveLength(1);
  expect(persistedProject.document.parametricAssets[0].shelfCount).toBe(4);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose a project" })).toBeVisible();
  await page
    .locator("button.project-card")
    .filter({ hasText: PROJECT_NAME })
    .click();

  await expect(page.locator(".save-state")).toHaveText("Saved");
  await expect(statValue(page, "Rooms")).toHaveText("1");
  await expect(statValue(page, "Walls")).toHaveText("4");
  await expect(statValue(page, "Openings")).toHaveText("1");

  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator("canvas.roomcraft-three-canvas")).toBeVisible();

  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  expect((await svgDownload).suggestedFilename()).toMatch(/\.svg$/);

  const glbDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GLB", exact: true }).click();
  expect((await glbDownload).suggestedFilename()).toMatch(/\.glb$/);
});

async function importAndCalibrateBlueprint(
  page: Page,
  plan: Locator,
) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGP88OEDAymAiSTVoxpGNQwpDQDL6ALwILfzLgAAAABJRU5ErkJggg==",
    "base64",
  );
  const blueprintInput = page.locator(
    'input[type="file"][accept*="image/png"]',
  );
  await blueprintInput.setInputFiles({
    name: "plan.png",
    mimeType: "image/png",
    buffer: png,
  });

  const blueprintPanel = page
    .locator(".selection-properties")
    .filter({ hasText: "Selected blueprint" });
  await expect(
    blueprintPanel.getByText("Selected blueprint", { exact: true }),
  ).toBeVisible();
  await blueprintPanel
    .getByRole("button", { name: "Unlock blueprint", exact: true })
    .click();
  await blueprintPanel
    .getByRole("button", { name: "Calibrate scale", exact: true })
    .click();

  const box = await requireBox(plan);
  await plan.click({
    position: { x: box.width * 0.35, y: box.height * 0.72 },
  });
  await plan.click({
    position: { x: box.width * 0.55, y: box.height * 0.72 },
  });

  const knownDistance = blueprintPanel.getByRole("textbox", {
    name: /Known distance/,
  });
  await expect(knownDistance).toBeVisible();
  await knownDistance.fill("3000 mm");
  await knownDistance.press("Enter");
}

async function drawClosedRoom(page: Page, plan: Locator) {
  await page.getByRole("button", { name: "Wall", exact: true }).click();
  const box = await requireBox(plan);
  const points = [
    { x: box.width * 0.3, y: box.height * 0.25 },
    { x: box.width * 0.65, y: box.height * 0.25 },
    { x: box.width * 0.65, y: box.height * 0.6 },
    { x: box.width * 0.3, y: box.height * 0.6 },
    { x: box.width * 0.3, y: box.height * 0.25 },
  ];

  await plan.click({ position: points[0]! });
  for (let index = 1; index < points.length; index += 1) {
    await plan.click({ position: points[index]! });
    await expect(statValue(page, "Walls")).toHaveText(String(index));
  }

  await expect(statValue(page, "Rooms")).toHaveText("1");
}

function statValue(page: Page, label: string) {
  return page
    .locator("dl.stats > div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd");
}

async function requireBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Plan canvas does not have a bounding box.");
  return box;
}
