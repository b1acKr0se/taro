// Renders mockup/tr-022-options.html's frames into ../images/options.
// Usage: node mockup/tr-022-shots.cjs <playwright module path>
const path = require("path");
const { chromium } = require(process.argv[2] || "playwright");
const page = "file://" + path.join(__dirname, "tr-022-options.html");
const out = path.join(__dirname, "..", "images", "options");
const frames = [
  ["a-board", { width: 1440, height: 760 }],
  ["a-accept", { width: 1440, height: 760 }],
  ["a-phone", { width: 780, height: 760 }],
  ["b-board", { width: 1440, height: 640 }],
  ["c-focus", { width: 1440, height: 560 }],
];
(async () => {
  const browser = await chromium.launch();
  for (const [name, viewport] of frames) {
    const tab = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await tab.goto(`${page}?frame=${name}`);
    await tab.screenshot({ path: path.join(out, `tr022-${name}.png`) });
    await tab.close();
  }
  await browser.close();
  console.log(`wrote ${frames.length} screenshots`);
})();
