import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { IDS, openSignedIn } from "./helpers";

const ROUTES = [
  "#/overview",
  "#/new",
  "#/runs",
  "#/tools",
  ...Object.values(IDS).map((id) => `#/runs/${id}`),
];

async function signIn(page: Page): Promise<void> {
  await openSignedIn(page, "#/overview");
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
}

async function visit(page: Page, hash: string): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  await expect(page.locator("main h1").first()).toBeVisible();
  // Let queries settle so the audited DOM is the loaded view, not a spinner.
  await expect(page.getByRole("status").filter({ hasText: /Đang tải/ })).toHaveCount(0);
}

test.describe("accessibility and layout gate", () => {
  test("login has no serious axe violations", async ({ page }) => {
    await page.goto("/#/overview");
    const result = await new AxeBuilder({ page }).analyze();
    const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test("every view has no serious axe violations", async ({ page }) => {
    await signIn(page);
    const failures: string[] = [];
    for (const hash of ROUTES) {
      await visit(page, hash);
      const result = await new AxeBuilder({ page }).analyze();
      for (const violation of result.violations) {
        if (violation.impact === "serious" || violation.impact === "critical") {
          failures.push(`${hash} ${violation.id} (${violation.nodes.length}): ${violation.nodes[0]?.target.join(" ")}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  for (const width of [1280, 390, 320]) {
    test(`no horizontal page scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page);
      const overflowing: string[] = [];
      for (const hash of ROUTES) {
        await visit(page, hash);
        const wide = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        if (wide) overflowing.push(hash);
      }
      expect(overflowing).toEqual([]);
    });
  }

  test("keyboard focus is visible on the approve button", async ({ page }) => {
    await signIn(page);
    await visit(page, `#/runs/${IDS.approval}`);
    const approve = page.getByRole("button", { name: "Duyệt 2 thao tác ghi" });
    await approve.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(approve).toBeFocused();
    const outline = await approve.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("request textarea shows a focus ring", async ({ page }) => {
    await signIn(page);
    await visit(page, "#/new");
    await page.getByLabel("Yêu cầu").focus();
    const ring = await page
      .locator("#request")
      .evaluate((el) => getComputedStyle(el.parentElement!).outlineStyle);
    expect(ring).not.toBe("none");
  });
});
