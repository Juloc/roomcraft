import { expect, test } from "@playwright/test";
import { createProject, desktopTool, requireBox, signIn } from "./helpers";

test("shift multi-select duplicates and deletes supported items as one action", async ({ page }) => {
  await signIn(page);
  await createProject(page, "E2E multi selection");

  const plan = page.getByRole("application", { name: "2D floor plan editor" });
  const box = await requireBox(plan);

  await desktopTool(page, "Furniture").click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await plan.click({ position: { x: box.width * 0.38, y: box.height * 0.42 } });
  await plan.click({ position: { x: box.width * 0.62, y: box.height * 0.42 } });
  await plan.click({ button: "right", position: { x: box.width * 0.8, y: box.height * 0.8 } });

  const footprints = page.locator(".plan-object__footprint");
  await expect(footprints).toHaveCount(2);

  await footprints.nth(0).click({ force: true });
  await footprints.nth(1).click({ force: true, modifiers: ["Shift"] });

  await expect(page.getByLabel("Multiple selection")).toContainText("2 items selected");

  await page.keyboard.press("Control+D");
  await expect(page.locator(".plan-object__footprint")).toHaveCount(4);
  await expect(page.getByLabel("Multiple selection")).toContainText("2 items selected");

  await page.keyboard.press("Delete");
  await expect(page.locator(".plan-object__footprint")).toHaveCount(2);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".plan-object__footprint")).toHaveCount(4);
});

test("dragging a wall moves both semantic endpoints in one command", async ({ page }) => {
  await signIn(page);
  const projectId = await createProject(page, "E2E wall move");

  const plan = page.getByRole("application", { name: "2D floor plan editor" });
  const box = await requireBox(plan);

  await desktopTool(page, "Draw walls").click();
  await plan.click({ position: { x: box.width * 0.25, y: box.height * 0.32 } });
  await plan.click({ position: { x: box.width * 0.55, y: box.height * 0.32 } });
  await plan.click({ button: "right", position: { x: box.width * 0.8, y: box.height * 0.8 } });
  await expect(page.locator(".save-state:visible")).toHaveText("Saved");

  const before = await readWallGeometry(page, projectId);
  const startX = box.x + box.width * 0.4;
  const startY = box.y + box.height * 0.32;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 110, startY + 70, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => {
    const current = await readWallGeometry(page, projectId);
    return [current.start.xMm, current.start.yMm, current.end.xMm, current.end.yMm];
  }).not.toEqual([
    before.start.xMm,
    before.start.yMm,
    before.end.xMm,
    before.end.yMm,
  ]);

  const after = await readWallGeometry(page, projectId);
  const startDelta = {
    x: after.start.xMm - before.start.xMm,
    y: after.start.yMm - before.start.yMm,
  };
  const endDelta = {
    x: after.end.xMm - before.end.xMm,
    y: after.end.yMm - before.end.yMm,
  };

  expect(startDelta).toEqual(endDelta);
  expect(Math.abs(startDelta.x) + Math.abs(startDelta.y)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => {
    const current = await readWallGeometry(page, projectId);
    return [current.start.xMm, current.start.yMm, current.end.xMm, current.end.yMm];
  }).toEqual([
    before.start.xMm,
    before.start.yMm,
    before.end.xMm,
    before.end.yMm,
  ]);
});

test("3D picking selects the same semantic object used by the 2D editor", async ({ page }) => {
  await signIn(page);
  await createProject(page, "E2E shared 3D selection");

  const plan = page.getByRole("application", { name: "2D floor plan editor" });
  const box = await requireBox(plan);

  await desktopTool(page, "Furniture").click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await plan.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await plan.click({ button: "right", position: { x: box.width * 0.8, y: box.height * 0.8 } });

  await plan.click({ position: { x: 24, y: 24 } });
  await expect(
    page.locator(".selection-properties").filter({ hasText: "Selected Box" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "3D", exact: true }).click();
  const canvas = page.locator("canvas.roomcraft-three-canvas");
  await expect(canvas).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("3D canvas does not have a bounding box.");

  await page.mouse.click(
    canvasBox.x + canvasBox.width / 2,
    canvasBox.y + canvasBox.height / 2,
  );

  await expect(
    page.locator(".selection-properties").filter({ hasText: "Selected Box" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "2D", exact: true }).click();
  await expect(page.locator(".plan-object--selected")).toHaveCount(1);
});

async function readWallGeometry(page: import("@playwright/test").Page, projectId: string) {
  return await page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Project read failed with ${response.status}`);
    const project = await response.json();
    const level = project.document.levels[0];
    const wall = level.walls[0];
    const start = level.vertices.find(
      (vertex: { id: string }) => vertex.id === wall.startVertexId,
    );
    const end = level.vertices.find(
      (vertex: { id: string }) => vertex.id === wall.endVertexId,
    );
    return { start, end };
  }, projectId) as {
    start: { xMm: number; yMm: number };
    end: { xMm: number; yMm: number };
  };
}
