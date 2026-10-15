// Drives Paseo's web app through a list of steps and reports page errors: node drive.cjs <playwright module> <url> <steps.json>
// Steps (one object each): {"click": "text"} ("=text" for an exact match), {"clickLabel": "accessibility label"},
// {"fill": "placeholder start", "text": "…"} (types into the field; "paste": true inserts it at once, as a paste does),
// {"press": "Enter", "times": 2} (into the focused element), {"wait": ms}, {"shot": "out.png"},
// {"offline": true|false} (drops or restores the network), {"run": "shell command"} (on the host, awaited),
// {"spawn": "shell command"} (on the host, not awaited), {"reload": true}, {"waitText": "text", "timeout": ms}.
// WIDTH/HEIGHT set the viewport; PHONE=1 draws a phone (390×844, touch).
const { execSync, spawn } = require("node:child_process");
const [, , playwrightPath, url, stepsPath] = process.argv;
const { chromium } = require(playwrightPath);
const steps = JSON.parse(require("node:fs").readFileSync(stepsPath, "utf8"));
(async () => {
  const browser = await chromium.launch();
  const phone = process.env.PHONE === "1";
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: Number(process.env.WIDTH || 1440), height: Number(process.env.HEIGHT || 900) },
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(4000);
  let field = null;
  for (const step of steps) {
    const started = Date.now();
    try {
      if (step.click !== undefined) {
        const exact = step.click.startsWith("=");
        await page.getByText(exact ? step.click.slice(1) : step.click, { exact }).filter({ visible: true }).first().click({ timeout: 8000 });
      } else if (step.clickLabel !== undefined) {
        // Forced: the reply box wrapper's aria-disabled reads to Playwright as a disabled button inside it.
        await page.getByLabel(step.clickLabel, { exact: true }).filter({ visible: true }).first().click({ timeout: 8000, clickCount: step.count ?? 1, delay: 0, force: true });
      } else if (step.fill !== undefined) {
        field = page.locator(`textarea[placeholder^="${step.fill}"]`).filter({ visible: true }).first();
        // Focused rather than clicked: the reply box's wrapper carries aria-disabled while it is not a button, which Playwright reads as a disabled field.
        await field.waitFor({ timeout: 8000 });
        await field.focus();
        if (step.paste === true) await page.keyboard.insertText(step.text);
        else await page.keyboard.type(step.text);
      } else if (step.press !== undefined) {
        for (let time = 0; time < (step.times ?? 1); time += 1) await page.keyboard.press(step.press);
      } else if (step.wait !== undefined) {
        await page.waitForTimeout(step.wait);
      } else if (step.shot !== undefined) {
        await page.screenshot({ path: step.shot });
      } else if (step.offline !== undefined) {
        await context.setOffline(step.offline);
      } else if (step.run !== undefined) {
        process.stdout.write(execSync(step.run, { encoding: "utf8" }));
      } else if (step.spawn !== undefined) {
        spawn("sh", ["-c", step.spawn], { stdio: "ignore", detached: true }).unref();
      } else if (step.reload === true) {
        await page.reload({ waitUntil: "networkidle" }).catch(() => {});
      } else if (step.waitText !== undefined) {
        await page.getByText(step.waitText).filter({ visible: true }).first().waitFor({ timeout: step.timeout ?? 30000 });
      }
      console.log(`ok ${JSON.stringify(step).slice(0, 100)} (${Date.now() - started} ms)`);
    } catch (error) {
      console.log(`FAILED ${JSON.stringify(step).slice(0, 100)}: ${String(error.message).split("\n").slice(0, 8).join(" / ")}`);
    }
  }
  console.log(errors.length === 0 ? "page errors: none" : `page errors:\n${errors.slice(0, 30).join("\n")}`);
  await browser.close();
})();
