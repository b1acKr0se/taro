// Renders the mockup at desktop and phone sizes into ../images.
// Usage: node mockup/screenshot.cjs <playwright module path> [base url]
// Serve this folder first, e.g. `python3 -m http.server 8765 --directory mockup`.
const path = require("path");
const { chromium } = require(process.argv[2] || "playwright");
const baseUrl = process.argv[3] || "http://127.0.0.1:8765";
const imagesDirectory = path.join(__dirname, "..", "images");

const shots = [
  ["desktop-inbox", { width: 1440, height: 900 }, () => {}],
  ["desktop-board", { width: 1440, height: 900 }, () => { setTab("shop"); selectTicket("SH-015"); }],
  ["desktop-ticket-detail", { width: 1440, height: 900 }, () => { setTab("shop"); selectTicket("SH-014"); setConversationTab("ticket"); }],
  ["desktop-add-project", { width: 1440, height: 2000 }, () => { openSetup(); }],
  ["desktop-project-settings", { width: 1440, height: 2000 }, () => { setTab("shop"); openSettings(); }],
  ["phone-manager", { width: 390, height: 844 }, () => {}],
  ["phone-inbox", { width: 390, height: 844 }, () => { setMobileTab("inbox"); }],
  ["phone-board", { width: 390, height: 844 }, () => { setMobileTab("board"); }],
  ["phone-project-sheet", { width: 390, height: 844 }, () => { openProjectSheet(); }],
  ["phone-task-owner", { width: 390, height: 844 }, () => { selectTicket("SH-015"); }],
  ["phone-add-project", { width: 390, height: 1900 }, () => { openSetup(); }],
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [name, viewport, prepare] of shots) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    page.on("pageerror", error => errors.push(`${name}: ${error.message}`));
    await page.goto(`${baseUrl}/index.html`);
    await page.evaluate(prepare);
    await page.screenshot({ path: path.join(imagesDirectory, `${name}.png`) });
    await page.close();
  }
  await browser.close();
  console.log(errors.length ? errors.join("\n") : `wrote ${shots.length} screenshots, no page errors`);
})();
