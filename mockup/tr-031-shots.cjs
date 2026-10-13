// Renders mockup/tr-031-options.html into ../images/options.
// Usage: node mockup/tr-031-shots.cjs <playwright module path>
const path = require("path");
const { chromium } = require(process.argv[2] || "playwright");
const page = "file://" + path.join(__dirname, "tr-031-options.html");
const out = path.join(__dirname, "..", "images", "options");
const frames = [
  ["cards-desktop-1", "frame=cards&width=260&half=1", 720],
  ["cards-desktop-2", "frame=cards&width=260&half=2", 720],
  ["cards-phone-1", "frame=cards&width=340&half=1", 880],
  ["cards-phone-2", "frame=cards&width=340&half=2", 880],
  ["tabs-desktop", "frame=tabs&width=1000", 1000],
  ["tabs-phone", "frame=tabs&width=390", 390],
];
(async () => {
  const browser = await chromium.launch();
  for (const [name, query, width] of frames) {
    const tab = await browser.newPage({ viewport: { width, height: 400 }, deviceScaleFactor: 2 });
    await tab.goto(`${page}?${query}`);
    await tab.screenshot({ path: path.join(out, `tr031-${name}.png`), fullPage: true });
    await tab.close();
  }
  await browser.close();
  console.log(`wrote ${frames.length} screenshots`);
})();
