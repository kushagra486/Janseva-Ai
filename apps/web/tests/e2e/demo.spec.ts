import { expect, test } from "@playwright/test";

// The five-minute demo, end to end, in demo mode (no Supabase, rules-only AI).
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => window.localStorage.setItem("janseva.consent.v1", "test"));
});

test("scan a sample notice and set a reminder", async ({ page }) => {
  await page.goto("/en/decode");
  await page.getByRole("button", { name: "Try a sample notice" }).click();
  await expect(page.getByText("You owe ₹4,860 for 2026-27")).toBeVisible();
  await expect(page.getByText(/31 October 2026/)).toBeVisible();
  await page.getByRole("button", { name: "Remind me" }).click();
  await page.goto("/en/deadlines");
  await expect(page.getByText("days left").first()).toBeVisible();
});

test("ask a Hinglish question and get a cited answer", async ({ page }) => {
  await page.goto("/en/services");
  await page.getByPlaceholder("e.g. Birth certificate kaise banwayein?").fill("House tax online kaise pay karein?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("link", { name: /Pay property \(house\) tax/ })).toBeVisible();
});

test("scheme finder as Sunita", async ({ page }) => {
  await page.goto("/en/schemes");
  await page.getByRole("button", { name: "Fill as Sunita (62, widow)" }).click();
  await expect(page.getByRole("heading", { name: "Widow Pension (Nirashrit Mahila Pension)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Old Age Pension/ })).toBeVisible();
});

test("officer approves a clustered issue", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("combobox").selectOption("officer");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("tab", { name: /Approval queue/ })).toBeVisible();
  const drain = page.getByRole("button", { name: /Water & drain.*3 reports/ });
  await drain.click();
  await page.getByRole("button", { name: "Approve & dispatch" }).click();
  await expect(page.getByRole("button", { name: "Mark work started" })).toBeVisible();
});
