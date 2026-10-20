/**
 * Puts text on the clipboard (TR-202). The plugin SDK has no clipboard, so the web (and the desktop
 * app) use the browser's and the phone uses the app's own Expo module (`attachment-sources.ts`).
 * Plain text only: Paseo's footer also writes the reply as HTML, which needs its Markdown renderer.
 */
import { expoModule } from "./attachment-sources";

function read(value: unknown, key: string): unknown {
  return (typeof value === "object" || typeof value === "function") && value !== null ? Reflect.get(value, key) : undefined;
}

/** Whether `text` reached the clipboard; false when this client has no way or it refused. */
export async function copyText(root: object, text: string): Promise<boolean> {
  try {
    const browser = read(read(root, "navigator"), "clipboard");
    const writeText = read(browser, "writeText");
    if (typeof writeText === "function") {
      await writeText.call(browser, text);
      return true;
    }
    const native = expoModule(root, "clipboardText");
    if (native === null) return false;
    await native["setStringAsync"]?.(text);
    return true;
  } catch {
    return false;
  }
}
