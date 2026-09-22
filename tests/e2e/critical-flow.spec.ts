import { expect, test, type Page } from "@playwright/test";

const PROJECT_ID = "project_e2e_critical_flow";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((projectId) => {
    window.localStorage.setItem("roomcraft.currentProjectId", projectId);
  }, PROJECT_ID);
});

test("builds, persists, reloads and exports a planned room", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("RoomCraft", { exact: true })).toBeVisible();
  await expect(page.locator(".save-state")).toHaveText("Saved");

  const plan = page.getByRole("application", {
    name: "2D floor plan editor",
  });
  await expect(plan).toBeVisible();

  await importAndCalibrateBlueprint(page, plan);
  await drawClosedRoom(page, plan);

  await expect(statValue(page, "Rooms")).toHaveText("1");
  await expect(statValue(page, "Walls")).toHaveText("4");

  const box = await requireBox(plan);
  const wallMidpoint = {
    x: box.width * 0.475,
    y: box.height * 0.25,
  };

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await plan.click({ position: wallMidpoint });

  const length = page.getByLabel("Length", { exact: true });
  await expect(length).toBeVisible();
  await length.fill("2500 mm");
  await length.press("Enter");
  await expect(length).toHaveValue("2500 mm");

  await page.getByRole("button", { name: "Door", exact: true }).click();
  await plan.click({ position: wallMidpoint });
  await expect(statValue(page, "Openings")).toHaveText("1");

  await page.getByRole("button", { name: "Furniture", exact: true }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await plan.click({
    position: {
      x: box.width * 0.54,
      y: box.height * 0.44,
    },
  });

  const furnitureWidth = page.getByLabel("Width", { exact: true });
  await expect(furnitureWidth).toBeVisible();
  await furnitureWidth.fill("1800 mm");
  await furnitureWidth.press("Enter");
  await expect(furnitureWidth).toHaveValue("1800 mm");

  await page.getByRole("button", { name: "New cabinet" }).click();
  await plan.click({
    position: {
      x: box.width * 0.4,
      y: box.height * 0.44,
    },
  });

  await expect(page.getByText("Cabinet construction", { exact: true })).toBeVisible();
  await expect(page.getByText("Cut list", { exact: true })).toBeVisible();

  const shelves = page.getByLabel("Shelves", { exact: true });
  await shelves.fill("4");
  await shelves.press("Enter");

  await expect(page.locator(".save-state")).toHaveText("Saved");

  const persisted = await page.request.get(`/api/projects/${PROJECT_ID}`);
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
  await expect(page.locator(".save-state")).toHaveText("Saved");
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

  for (const point of points) {
    await plan.click({ position: point });
  }
}

function statValue(page: Page, label: string) {
  return page
    .locator("dl.stats > div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd");
}

async function requireBox(locator: ReturnType<Page["getByRole"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Plan canvas does not have a bounding box.");
  return box;
}
