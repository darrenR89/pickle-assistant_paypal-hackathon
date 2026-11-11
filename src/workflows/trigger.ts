// Cron job script: start one `tick` run of the workflow, then exit.
// Needs RENDER_API_KEY and WORKFLOW_SLUG (the workflow's slug from the Render Dashboard).
import { Render } from "@renderinc/sdk";
import { withRetry } from "./retry";

const slug = process.env.WORKFLOW_SLUG ?? "pickle-assistant-workflows";
const render = new Render();

async function main() {
  // One run per 10-minute window. The same key on every attempt makes a retry safe:
  // if an earlier attempt did reach Render, this returns that run instead of a second one.
  const windowKey = new Date(Math.floor(Date.now() / 600_000) * 600_000).toISOString();
  const idempotencyKey = `tick-${windowKey}`;
  const run = await withRetry((signal) => render.workflows.startTask(`${slug}/tick`, [], { idempotencyKey, signal }), {
    attempts: 4,
    timeoutMs: 30_000,
    waitMs: (attempt) => attempt * 10_000,
    onRetry: (attempt, err) => console.warn(`Starting ${slug}/tick failed (attempt ${attempt}), retrying:`, err),
  });
  console.log(`Started ${slug}/tick: ${run.taskRunId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
