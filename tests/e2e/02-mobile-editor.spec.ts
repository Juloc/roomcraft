import { expect, test } from "@playwright/test";
import { createProject, requireBox, signIn } from "./helpers";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("phone editor stays viewport-bound and uses touch-native controls", async ({ page }) => {
  await signIn(page);
  await createProject(page, "E2E mobile room");

  const plan = page.getByRole("application", { name: "2D floor plan editor" });
  await expect(plan).toBeVisible();
  await expect(page.locator(".mobile-tool-bar")).toBeVisible();
  await expect(page.locator(".desktop-command-bar")).toBeHidden();
  await expect(page.locator(".tool-rail")).toBeHidden();
  await expect(page.getByRole("button", { name: "Back to projects" })).toBeVisible();

  const layout = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
    appHeight: document.querySelector(".app-shell")?.getBoundingClientRect().height ?? 0,
    bodyOverflow: getComputedStyle(document.body).overflow,
  }));

  expect(layout.bodyOverflow).toBe("hidden");
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight + 2);
  expect(Math.abs(layout.appHeight - layout.innerHeight)).toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "Wall", exact: true }).click();
  const box = await requireBox(plan);

  const left = box.x + box.width * 0.35;
  const right = box.x + box.width * 0.65;
  const y = box.y + box.height * 0.45;

  await plan.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: left,
    clientY: y,
  });
  await plan.dispatchEvent("pointerdown", {
    pointerId: 2,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    buttons: 1,
    clientX: right,
    clientY: y,
  });
  await plan.dispatchEvent("pointermove", {
    pointerId: 2,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    buttons: 1,
    clientX: right + 28,
    clientY: y + 8,
  });
  await plan.dispatchEvent("pointerup", {
    pointerId: 2,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    buttons: 0,
    clientX: right + 28,
    clientY: y + 8,
  });
  await plan.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 0,
    clientX: left,
    clientY: y,
  });

  await expect(plan.locator(".plan-wall-hit")).toHaveCount(0);

  await page.touchscreen.tap(
    box.x + box.width * 0.3,
    box.y + box.height * 0.32,
  );
  await page.touchscreen.tap(
    box.x + box.width * 0.7,
    box.y + box.height * 0.32,
  );
  await expect(plan.locator(".plan-wall-hit")).toHaveCount(1);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await plan.locator(".plan-wall-hit").first().click({ force: true });

  const sheet = page.locator(".editor-properties-sheet");
  await expect(sheet).toHaveClass(/rc-sheet--open/);
  await expect(sheet.getByText("Selected wall", { exact: true })).toBeVisible();

  await sheet.getByRole("button", { name: "Close Properties" }).click();
  await expect(sheet).not.toHaveClass(/rc-sheet--open/);

  // A closed sheet must not remain in the hit-test tree and block the toolbar.
  const wallTool = page.getByRole("button", { name: "Wall", exact: true });
  await wallTool.click();
  await expect(wallTool).toHaveClass(/mobile-tool--active/);

  await page.locator(".mobile-header-actions .rc-menu__trigger").click();
  await page.getByRole("button", { name: "3D view" }).click();
  await expect(page.locator("canvas.roomcraft-three-canvas")).toBeVisible();
  await expect(page.locator(".mobile-tool-bar")).toBeVisible();

  const finalLayout = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
  }));
  expect(finalLayout.scrollHeight).toBeLessThanOrEqual(finalLayout.innerHeight + 2);
});
