import { expect, test, type Page } from "@playwright/test";
import { createProject, requireBox, signIn, statValue } from "./helpers";

const PROJECT_NAME = "E2E critical room";

test("builds, persists, reloads and exports a planned room", async ({ page }) => {
  await signIn(page);
  const projectId = await createProject(page, PROJECT_NAME);

  const plan = page.getByRole("application", { name: "2D floor plan editor" });
  await importAndCalibrateBlueprint(page, plan);
  await drawClosedRoom(page, plan);

  await expect(statValue(page, "Rooms")).toHaveText("1");
  await expect(statValue(page, "Walls")).toHaveText("4");

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

  const box = await requireBox(plan);
  await page.getByRole("button", { name: "Furniture", exact: true }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await plan.click({
    position: { x: box.width * 0.54, y: box.height * 0.44 },
  });

  const tablePanel = page
    .locator(".selection-properties")
    .filter({ hasText: "Selected Table" });
  const furnitureWidth = tablePanel.getByRole("textbox", { name: /Width/ });
  await expect(furnitureWidth).toBeVisible();
  await furnitureWidth.fill("1800 mm");
  await furnitureWidth.press("Enter");
  await expect(furnitureWidth).toHaveValue("1800 mm");

  await page.getByRole("button", { name: "New cabinet" }).click();
  await plan.click({
    position: { x: box.width * 0.4, y: box.height * 0.44 },
  });

  await expect(page.getByText("Cabinet construction", { exact: true })).toBeVisible();
  await expect(page.getByText("Cut list", { exact: true })).toBeVisible();

  const cabinetBuilder = page.locator(".cabinet-builder");
  const shelves = cabinetBuilder.getByRole("textbox", { name: /Shelves/ });
  await shelves.fill("4");
  await shelves.press("Enter");

  await expect(page.locator(".save-state:visible")).toHaveText("Saved");

  const persistedProject = await page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Project read failed with ${response.status}`);
    return await response.json();
  }, projectId);

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
  await page.getByRole("button", { name: PROJECT_NAME }).click();

  await expect(page.locator(".save-state:visible")).toHaveText("Saved");
  await expect(statValue(page, "Rooms")).toHaveText("1");
  await expect(statValue(page, "Walls")).toHaveText("4");
  await expect(statValue(page, "Openings")).toHaveText("1");

  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator("canvas.roomcraft-three-canvas")).toBeVisible();

  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG" }).click();
  expect((await svgDownload).suggestedFilename()).toMatch(/\.svg$/);

  const glbDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GLB" }).click();
  expect((await glbDownload).suggestedFilename()).toMatch(/\.glb$/);
});

async function importAndCalibrateBlueprint(
  page: Page,
  plan: ReturnType<Page["getByRole"]>,
) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGP88OEDAymAiSTVoxpGNQwpDQDL6ALwILfzLgAAAABJRU5ErkJggg==",
    "base64",
  );
  const blueprintInput = page.locator('input[type="file"][accept*="image/png"]');
  await blueprintInput.setInputFiles({
    name: "plan.png",
    mimeType: "image/png",
    buffer: png,
  });

  const blueprintPanel = page
    .locator(".selection-properties")
    .filter({ hasText: "Selected blueprint" });
  await expect(blueprintPanel.getByText("Selected blueprint", { exact: true })).toBeVisible();
  await blueprintPanel.getByRole("button", { name: "Unlock blueprint", exact: true }).click();
  await blueprintPanel.getByRole("button", { name: "Calibrate scale", exact: true }).click();

  const box = await requireBox(plan);
  await plan.click({ position: { x: box.width * 0.35, y: box.height * 0.72 } });
  await plan.click({ position: { x: box.width * 0.55, y: box.height * 0.72 } });

  const knownDistance = blueprintPanel.getByRole("textbox", { name: /Known distance/ });
  await expect(knownDistance).toBeVisible();
  await knownDistance.fill("3000 mm");
  await knownDistance.press("Enter");
}

async function drawClosedRoom(
  page: Page,
  plan: ReturnType<Page["getByRole"]>,
) {
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
