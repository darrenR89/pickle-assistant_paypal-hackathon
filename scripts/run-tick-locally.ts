// Run the workflow's `tick` once, in this process, against DATABASE_URL.
// Chained task runs execute inline instead of on Render. Usage: pnpm tick:local
import type { TaskContext } from "@renderinc/sdk/workflows";
import { tick } from "@/workflows/tasks";

const ctx = {
  run: (t: { func: (ctx: TaskContext, ...a: unknown[]) => unknown }, ...args: unknown[]) => t.func(ctx, ...args),
  metadata: {},
} as unknown as TaskContext;

Promise.resolve(tick.func(ctx))
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
