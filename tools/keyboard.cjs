// node keyboard.cjs <playwright> <url> <out-prefix> <field> [click text...] — Paseo's web app at phone size:
// opens Taro, clicks, focuses the field as a tap would, then simulates a 336-point keyboard by shrinking
// the visual viewport (what a phone browser does) and drawing a keyboard-sized block over the bottom.
// Writes <out-prefix>-focused.png and <out-prefix>-keyboard.png and prints the field's box before and
// after. <field>: a placeholder, "@<accessibility label>", "last-textarea" or "last-input"; a click text
// starting with "=" matches exactly, with "@" an accessibility label. FIELD_AT_BOTTOM=1 first scrolls
// the field to the screen's bottom edge; TYPE_LINES=<n> types n lines after the keyboard opens.
const [, , playwrightPath, url, prefix, fieldSpec, ...clicks] = process.argv;
const { chromium } = require(playwrightPath);
const KEYBOARD = 336;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.mouse.click(24, 36);
  await page.waitForTimeout(1500);
  await page.getByText("Taro", { exact: true }).first().click({ timeout: 8000 }).catch((e) => errors.push(`open Taro: ${e.message.split("\n")[0]}`));
  await page.waitForTimeout(3000);
  for (const text of clicks) {
    const exact = text.startsWith("=");
    const target = text.startsWith("@") ? page.getByLabel(text.slice(1), { exact: true }) : page.getByText(exact ? text.slice(1) : text, { exact });
    await target.first().click({ timeout: 8000 }).catch((e) => errors.push(`click ${text}: ${e.message.split("\n")[0]}`));
    await page.waitForTimeout(2500);
  }
  const field = fieldSpec === "last-textarea" ? page.locator("textarea").last() : fieldSpec === "last-input" ? page.locator("input[type=text], input:not([type]), textarea").last() : fieldSpec.startsWith("@") ? page.getByLabel(fieldSpec.slice(1), { exact: true }).last() : page.getByPlaceholder(fieldSpec).first();
  // As a tap on a phone: focus without the browser scrolling the field into view itself.
  // A field the reader scrolled to the bottom edge of the screen, then tapped.
  if (process.env.FIELD_AT_BOTTOM) await field.evaluate((element) => element.scrollIntoView({ block: "end" }));
  await page.waitForTimeout(300);
  await field.evaluate((element) => element.focus({ preventScroll: true })).catch((e) => errors.push(`focus: ${e.message.split("\n")[0]}`));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${prefix}-focused.png` });
  const before = await field.boundingBox();
  await page.evaluate((keyboard) => {
    const top = window.innerHeight - keyboard;
    Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => top });
    const block = document.createElement("div");
    block.id = "simulated-keyboard";
    block.textContent = "simulated keyboard (336 pt)";
    Object.assign(block.style, { position: "fixed", left: "0", right: "0", bottom: "0", height: `${keyboard}px`, background: "rgba(90,90,100,0.92)", color: "#ddd", font: "14px sans-serif", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "2147483647", pointerEvents: "none" });
    document.body.appendChild(block);
    window.visualViewport.dispatchEvent(new Event("resize"));
  }, KEYBOARD);
  await page.waitForTimeout(1500);
  if (process.env.TYPE_LINES) {
    for (let line = 0; line < Number(process.env.TYPE_LINES); line += 1) await page.keyboard.type(`Line ${line + 1} of a longer note\n`);
    await page.waitForTimeout(1500);
  }
  const after = await field.boundingBox();
  await page.screenshot({ path: `${prefix}-keyboard.png` });
  const keyboardTop = 844 - KEYBOARD;
  console.log(JSON.stringify({ keyboardTop, before, after, fieldBottomAboveKeyboard: after !== null && after.y + after.height <= keyboardTop, fieldTopOnScreen: after !== null && after.y >= 0 }));
  console.log(errors.join("\n"));
  await browser.close();
})();
