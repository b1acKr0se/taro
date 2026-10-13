// Renders mockup/tr-026-options.html's frames into ../images/options.
// Usage: node mockup/tr-026-shots.cjs <playwright module path>
const path = require("path");
const { chromium } = require(process.argv[2] || "playwright");
const page = "file://" + path.join(__dirname, "tr-026-options.html");
const out = path.join(__dirname, "..", "images", "options");
const frames = [
  ["cards-a", { width: 1440, height: 640 }],
  ["cards-b", { width: 1440, height: 560 }],
  ["accept-a", { width: 1440, height: 720 }],
  ["accept-a-phone", { width: 840, height: 800 }],
  ["accept-b", { width: 1440, height: 720 }],
  ["accept-c", { width: 1440, height: 720 }],
];
(async () => {
  const browser = await chromium.launch();
  for (const [name, viewport] of frames) {
    const tab = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await tab.goto(`${page}?frame=${name}`);
    await tab.screenshot({ path: path.join(out, `tr026-${name}.png`), fullPage: true });
    await tab.close();
  }
  await browser.close();
  console.log(`wrote ${frames.length} screenshots`);
})();
