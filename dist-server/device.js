// multibot (G3): read-only device scan for onboarding.
import { execFile } from "node:child_process";
import { hostname, totalmem } from "node:os";
import { enginePython } from "./engine/supervisor.js";
import { augmentedPath, resolveCliSpawn } from "./env-path.js";
async function version(command, args) {
    let cli;
    try {
        cli = resolveCliSpawn(command, args);
    }
    catch {
        return null;
    }
    return new Promise((resolve) => execFile(cli.command, cli.args, {
        timeout: 5_000,
        windowsVerbatimArguments: cli.windowsVerbatimArguments,
        env: { ...process.env, PATH: augmentedPath() },
    }, (error, stdout, stderr) => resolve(error ? null : String(stdout || stderr).trim().split(/\r?\n/, 1)[0] || null)));
}
async function firstVersion(candidates) {
    for (const [command, args] of candidates) {
        const found = await version(command, args);
        if (found)
            return found;
    }
    return null;
}
async function property(name) {
    if (process.platform === "win32")
        return null;
    return new Promise((resolve) => execFile("getprop", [name], { timeout: 2_000, env: { ...process.env, PATH: augmentedPath() } }, (error, stdout) => resolve(error ? null : String(stdout).trim() || null)));
}
export async function deviceInfo() {
    const [pythonVersion, dockerVersion, manufacturer, model, androidVersion] = await Promise.all([
        firstVersion(process.platform === "win32" ? [["py", ["-3", "--version"]], ["python", ["--version"]]] : [["python3", ["--version"]], ["python", ["--version"]]]),
        version("docker", ["--version"]),
        property("ro.product.manufacturer"),
        property("ro.product.model"),
        property("ro.build.version.release"),
    ]);
    const ramBytes = totalmem();
    const termux = Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux"));
    return {
        hostname: hostname(),
        platform: process.platform,
        arch: process.arch,
        ramBytes,
        memoryGb: Math.round((ramBytes / 1024 ** 3) * 10) / 10,
        python: Boolean(pythonVersion),
        pythonVersion,
        docker: Boolean(dockerVersion),
        dockerVersion,
        engineInstalled: Boolean(enginePython()),
        android: Boolean(manufacturer || model || androidVersion),
        termux,
        manufacturer,
        model,
        androidVersion,
    };
}
