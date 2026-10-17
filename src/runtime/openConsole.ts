/**
 * openConsole.ts — opens the console URL in the default browser.
 *
 * Used once, after the listener is up, when "启动后自动打开控制台" is on.
 * The child is detached and its stdio is ignored so a closed browser or a
 * headless box can never block the gateway.
 */
import { spawn } from "node:child_process";

type PlatformCommand = { command: string; args: (url: string) => string[] };

const commands: Record<string, PlatformCommand> = {
  win32: { command: "cmd", args: (url) => ["/c", "start", "", url] },
  darwin: { command: "open", args: (url) => [url] },
  linux: { command: "xdg-open", args: (url) => [url] },
};

/**
 * Fires the browser and returns immediately. Failures are reported through
 * `onError` because spawn errors are asynchronous.
 */
export const openConsole = (url: string, onError?: (message: string) => void): void => {
  const target = commands[process.platform];
  if (!target) {
    onError?.("unsupported platform: " + process.platform);
    return;
  }
  try {
    const child = spawn(target.command, target.args(url), { detached: true, stdio: "ignore" });
    child.on("error", (error: Error) => onError?.(error.message));
    child.unref();
  } catch (error) {
    onError?.(error instanceof Error ? error.message : String(error));
  }
};
