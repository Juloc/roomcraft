import { expect, test } from "@playwright/test";
import { createProject, desktopTool, requireBox, signIn, statValue } from "./helpers";

test("crossing walls are split into shared topology automatically", async ({ page }) => {
  await signIn(page);
  await createProject(page, "E2E topology");

  const plan = page.getByRole("application", { name: "2D floor plan editor" });
  const box = await requireBox(plan);

  await desktopTool(page, "Draw walls").click();
  await plan.click({ position: { x: box.width * 0.28, y: box.height * 0.5 } });
  await plan.click({ position: { x: box.width * 0.72, y: box.height * 0.5 } });
  await plan.click({ button: "right", position: { x: box.width * 0.8, y: box.height * 0.8 } });

  await desktopTool(page, "Draw walls").click();
  await plan.click({ position: { x: box.width * 0.5, y: box.height * 0.28 } });
  await plan.click({ position: { x: box.width * 0.5, y: box.height * 0.72 } });
  await plan.click({ button: "right", position: { x: box.width * 0.8, y: box.height * 0.8 } });

  await expect(statValue(page, "Walls")).toHaveText("4");
  await expect(statValue(page, "Topology")).toHaveText("OK");
  await expect(page.locator(".plan-wall-hit")).toHaveCount(4);

  await desktopTool(page, "Select and pan").click();
  await page.locator(".plan-wall-hit").first().click({ force: true });

  await expect(page.getByRole("group", { name: "Fixed wall endpoint" })).toBeVisible();
  const thickness = page.getByRole("textbox", { name: /Thickness/ });
  await thickness.fill("180");
  await thickness.press("Enter");
  await expect(thickness).toHaveValue("180");

  const angle = page.getByRole("textbox", { name: /Angle/ });
  await angle.fill("0");
  await angle.press("Enter");

  await expect(page.locator(".wall-vertex-handle")).toHaveCount(2);
});
