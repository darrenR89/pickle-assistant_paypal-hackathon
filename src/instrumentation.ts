// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { sendblueConfigured } = await import("@/lib/sendblue");
  if (!sendblueConfigured()) return;
  const { startSendbluePoller } = await import("@/bot/sendblue");
  startSendbluePoller();
}
