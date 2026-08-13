// multibot (G7): onboarding's explicit 24/7 choice registers packaged Windows
// app as a per-user ONLOGON server. No shell, elevation or development runtime.
import { execFile } from "node:child_process";
import { win32 } from "node:path";
const TASK_NAME = "Multibot Server";
export function windowsAutostartArgs(packagedExe) {
    if (!win32.isAbsolute(packagedExe) || !packagedExe.toLowerCase().endsWith(".exe")) {
        throw new Error("packaged Windows executable must be an absolute .exe path");
    }
    return [
        "/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED",
        "/TN", TASK_NAME, "/TR", `"${packagedExe}" --server-only`,
    ];
}
const runFile = (command, args) => new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, shell: false }, (error) => error ? reject(error) : resolve());
});
export async function registerWindowsServerAutostart(packagedExe, runner = runFile) {
    await runner("schtasks.exe", windowsAutostartArgs(packagedExe));
}
