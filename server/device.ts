// multibot (G3): read-only device scan for onboarding.
import { execFile } from "node:child_process";
import { hostname, totalmem } from "node:os";

import { enginePython } from "./engine/supervisor.ts";
import { augmentedPath, resolveCliSpawn } from "./env-path.ts";

async function version(command: string, args: string[]): Promise<string | null> {
  let cli: ReturnType<typeof resolveCliSpawn>;
  try {
    cli = resolveCliSpawn(command, args);
  } catch {
    return null;
  }
  return new Promise((resolve) =>
    execFile(
      cli.command,
      cli.args,
      {
        timeout: 5_000,
        windowsVerbatimArguments: cli.windowsVerbatimArguments,
        env: { ...process.env, PATH: augmentedPath() },
      },
      (error, stdout, stderr) => resolve(error ? null : String(stdout || stderr).trim().split(/\r?\n/, 1)[0] || null),
    ),
  );
}

async function firstVersion(candidates: Array<[string, string[]]>): Promise<string | null> {
  for (const [command, args] of candidates) {
    const found = await version(command, args);
    if (found) return found;
  }
  return null;
}

export async function deviceInfo() {
  const [pythonVersion, dockerVersion] = await Promise.all([
    firstVersion(process.platform === "win32" ? [["py", ["-3", "--version"]], ["python", ["--version"]]] : [["python3", ["--version"]], ["python", ["--version"]]]),
    version("docker", ["--version"]),
  ]);
  const ramBytes = totalmem();
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
  };
}
