// Renders mockup/tr-030-options.html's designs into ../images/options.
// Usage: node mockup/tr-030-shots.cjs <playwright module path>
const path = require("path");
const { chromium } = require(process.argv[2] || "playwright");
const page = "file://" + path.join(__dirname, "tr-030-options.html");
const out = path.join(__dirname, "..", "images", "options");
const frames = [];
for (const design of ["now", "a", "b", "c"]) {
  frames.push([`${design}-desktop`, design, 820, { width: 852, height: 600 }]);
  frames.push([`${design}-phone`, design, 390, { width: 390, height: 844 }]);
}
(async () => {
  const browser = await chromium.launch();
  for (const [name, design, width, viewport] of frames) {
    const tab = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    await tab.goto(`${page}?design=${design}&width=${width}`);
    await tab.screenshot({ path: path.join(out, `tr030-${name}.png`), fullPage: true });
    await tab.close();
  }
  await browser.close();
  console.log(`wrote ${frames.length} screenshots`);
})();
