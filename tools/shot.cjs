// node shot.cjs <playwright module> <url> <out.png> [click text...] — opens Paseo's web app and screenshots.
// WIDTH/HEIGHT set the viewport; COLOR_SCHEME=dark draws Paseo's dark theme.
const [, , playwrightPath, url, out, ...clicks] = process.argv;
const { chromium } = require(playwrightPath);
(async () => {
  const browser = await chromium.launch();
  const width = Number(process.env.WIDTH || 1440);
  const height = Number(process.env.HEIGHT || 900);
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: process.env.COLOR_SCHEME === "dark" ? "dark" : "light" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(4000);
  for (const text of clicks) {
    const exact = text.startsWith("=");
    const target = page.getByText(exact ? text.slice(1) : text, { exact }).filter({ visible: true }).first();
    await target.click({ timeout: 8000 }).catch((error) => errors.push(`click ${text}: ${error.message.split("\n")[0]}`));
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: out });
  console.log("URL", page.url());
  console.log(errors.slice(0, 15).join("\n"));
  await browser.close();
})();
