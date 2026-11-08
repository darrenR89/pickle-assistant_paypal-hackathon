// Cron job script: start one `tick` run of the workflow, then exit.
// Needs RENDER_API_KEY and WORKFLOW_SLUG (the workflow's slug from the Render Dashboard).
import { Render } from "@renderinc/sdk";

const slug = process.env.WORKFLOW_SLUG ?? "pickle-assistant-workflows";
const render = new Render();

async function main() {
  // One run per 10-minute window, even if the cron job is retried.
  const windowKey = new Date(Math.floor(Date.now() / 600_000) * 600_000).toISOString();
  const run = await render.workflows.startTask(`${slug}/tick`, [], { idempotencyKey: `tick-${windowKey}` });
  console.log(`Started ${slug}/tick: ${run.taskRunId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
