import { type ChildProcess, spawn } from "node:child_process";
import type { Plan } from "./planner.js";
export async function executePlan(
  plan: Plan,
  options: { cwd?: string; concurrency?: number; json?: boolean } = {},
): Promise<number> {
  const tasks = plan.tasks.filter((t) => t.decision === "run");
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64)
    throw new RangeError("concurrency must be an integer from 1 to 64");
  const children = new Set<ChildProcess>();
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    for (const child of children) {
      if (!child.pid) continue;
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/t", "/f"],
          { stdio: "ignore", windowsHide: true },
        );
        killer.on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
      }
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let next = 0,
    failed = false;
  const worker = async () => {
    while (!interrupted && next < tasks.length) {
      const task = tasks[next++];
      if (!task) break;
      const code = await new Promise<number>((resolve) => {
        const child = spawn(task.command, {
          cwd: options.cwd,
          shell: true,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: options.json
            ? ["inherit", process.stderr, process.stderr]
            : "inherit",
        });
        children.add(child);
        child.on("error", () => {
          children.delete(child);
          resolve(1);
        });
        child.on("close", (code) => {
          children.delete(child);
          resolve(code ?? 1);
        });
      });
      if (code !== 0) failed = true;
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(tasks.length, concurrency) }, worker),
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  return failed || interrupted ? 1 : 0;
}
