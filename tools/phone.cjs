// node phone.cjs <playwright> <out.png> [click text...] — Paseo's web app at phone size; opens the menu, then Taro. COLOR_SCHEME=dark for the dark theme.
const [, , playwrightPath, out, ...clicks] = process.argv;
const { chromium } = require(playwrightPath);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: process.env.COLOR_SCHEME === "dark" ? "dark" : "light" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(process.env.TARO_WEB_URL ?? "http://127.0.0.1:6799/", { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.mouse.click(24, 36);
  await page.waitForTimeout(1500);
  await page.getByText("Taro", { exact: true }).first().click({ timeout: 8000 }).catch((error) => errors.push(`open Taro: ${error.message.split("\n")[0]}`));
  await page.waitForTimeout(3000);
  for (const text of clicks) {
    const exact = text.startsWith("=");
    await page.getByText(exact ? text.slice(1) : text, { exact }).first().click({ timeout: 8000 }).catch((error) => errors.push(`click ${text}: ${error.message.split("\n")[0]}`));
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: out });
  console.log("URL", page.url());
  console.log(errors.join("\n"));
  await browser.close();
})();
