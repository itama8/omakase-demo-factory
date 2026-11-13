import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

// Pinned, so a render today and a render next month use the same renderer.
const HYPERFRAMES = "hyperframes@0.9.30";

export async function runHyperframes({ root, cwd, args, command = "npx", prefix = ["--yes", HYPERFRAMES] }) {
  // Every invocation owns its disk-backed cache; concurrent renders stay safe.
  const base = path.join(root, "out", "tmp", "hyperframes");
  await mkdir(base, { recursive: true });
  const temporary = await mkdtemp(path.join(base, "run-"));
  const signals = new Map();
  let interrupted;
  try {
    const child = spawn(command, [...prefix, ...args], {
      cwd,
      stdio: "inherit",
      detached: true,
      env: {
        ...process.env,
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
        HYPERFRAMES_EXTRACT_CACHE_DIR: path.join(temporary, "frames"),
      },
    });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => {
        interrupted = signal;
        // npx launches descendants; cancel the whole group.
        try { process.kill(-child.pid, signal); } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      };
      signals.set(signal, handler);
      process.on(signal, handler);
    }
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (interrupted || signal || code !== 0) {
      throw new Error(`hyperframes ${args[0]} failed (${interrupted ?? signal ?? `exit ${code}`})`);
    }
  } finally {
    for (const [signal, handler] of signals) process.removeListener(signal, handler);
    await rm(temporary, { recursive: true, force: true });
  }
}
