// The phone demo: a judge scans a QR code and runs a game from their own phone as the
// organizer, while the desktop page plays everyone else in the chat. The assistant (Claude)
// and the judge's own PayPal sandbox hold are real; the other players and their holds are simulated.

import { one, q } from "./db";
import { type Game, inPlayers, openGameForGroup, roster } from "./games";
import { DEMO_PLAYER, createPlaygroundGroup, groupPeople } from "./playground";
import { addContact, sendblueNumber } from "./sendblue";
import { normalizePhone } from "./phone";
import { moveClock, runDue, simulatedJoin } from "./sim";
import { handleGroupMessage, playerOut } from "@/bot/assistant";

/** The friends who say they're in, and the one the judge can become to try paying. */
const FRIENDS: Array<[string, string]> = [
  ["Sam", "yeah I'm down"],
  ["Priya", "count me in!"],
  ["Mei", "in 🙌"],
];
const PLAYER_ROLE = DEMO_PLAYER;
const LATE_LINE = "ugh, something came up. I can't make it tonight, sorry!";

export const SETUP_MESSAGE = "@Assistant Thu 6-8pm Riverside Park courts 3–4, 1200 Riverside Dr, mixed doubles, 3.0-3.5, $64";

export async function createDemo() {
  const groupId = await createPlaygroundGroup();
  const people = await groupPeople(groupId);
  await q("update groups set demo_viewer = $2 where id = $1", [groupId, people[0].id]);
  return groupId;
}

async function demoGroup(groupId: string) {
  return one<{ id: string; playground: boolean; demo_viewer: string | null; demo_name: string | null; demo_phone: string | null; demo_code: string | null }>(
    "select id, playground, demo_viewer, demo_name, demo_phone, demo_code from groups where id = $1",
    [groupId],
  );
}

async function latestGame(groupId: string) {
  return (await openGameForGroup(groupId)) ?? (await one<Game>("select * from games where group_id = $1 and status <> 'cancelled' order by created_at desc limit 1", [groupId]));
}

/** What both screens need: who the phone is acting as, and where the game stands. */
export async function demoState(groupId: string) {
  const g = await demoGroup(groupId);
  if (!g?.playground) return null;
  const people = await groupPeople(groupId);
  const organizer = people[0];
  const viewer = people.find((p) => p.id === g.demo_viewer) ?? organizer;
  const game = await latestGame(groupId);
  let gameInfo = null;
  if (game) {
    const entries = await roster(game.id);
    const playing = inPlayers(entries);
    const jo = people.find((p) => p.name === PLAYER_ROLE);
    const joSpot = entries.find((e) => e.person_id === jo?.id);
    gameInfo = {
      slug: game.slug,
      status: game.status,
      spots: game.spots,
      inCount: playing.length,
      over: Date.now() > new Date(game.starts_at).getTime(),
      lateWaiting: entries.some((e) => e.late_cancel === "pending"),
      // The judge's own hold, placed as Jo through the real PayPal sandbox.
      playerHold: joSpot ? { status: joSpot.hold_status, real: !!joSpot.authorization_id && !joSpot.authorization_id.startsWith("SIM-"), cents: joSpot.hold_cents ?? 0, captured: joSpot.captured_cents ?? 0 } : null,
    };
  }
  return {
    groupId,
    connected: !!g.demo_name,
    name: g.demo_name,
    organizer: { id: organizer.id, name: organizer.name, token: organizer.token },
    viewer: { id: viewer.id, name: viewer.name, token: viewer.token, role: viewer.id === organizer.id ? "organizer" : "player" },
    organizerToken: game?.organizer_token ?? null,
    // Using the judge's own Messages app instead of the on-screen phone (Sendblue). Null when not set up.
    texting: sendblueNumber()
      ? { number: sendblueNumber(), code: g.demo_phone ? g.demo_code : null, linked: !!g.demo_phone && !g.demo_code && !!g.demo_name }
      : null,
    game: gameInfo,
    // A PayPal sandbox test buyer (fake money) so judges can pay without their own developer account.
    buyer: process.env.DEMO_BUYER_EMAIL && process.env.DEMO_BUYER_PASSWORD ? { email: process.env.DEMO_BUYER_EMAIL, password: process.env.DEMO_BUYER_PASSWORD } : null,
  };
}

export type DemoAction =
  | { action: "connect"; name?: string }
  | { action: "text"; name?: string; phone?: string }
  | { action: "start" }
  | { action: "friends" }
  | { action: "player" }
  | { action: "organizer" }
  | { action: "late" }
  | { action: "after" };

/** Run one step. Each returns a short line for the desktop page. */
export async function demoAct(groupId: string, a: DemoAction): Promise<{ ok: boolean; note: string }> {
  const g = await demoGroup(groupId);
  if (!g?.playground) return { ok: false, note: "Unknown demo" };
  const people = await groupPeople(groupId);
  const organizer = people[0];
  const byName = (n: string) => people.find((p) => p.name === n)!;
  const game = await openGameForGroup(groupId);
  const setViewer = (id: string) => q("update groups set demo_viewer = $2 where id = $1", [groupId, id]);

  switch (a.action) {
    case "connect": {
      const name = (a.name ?? "").trim().replace(/[^\p{L}' -]/gu, "").slice(0, 20);
      if (!name) return { ok: false, note: "Add your first name" };
      // The judge becomes the organizer. Keep the cast's names free so they don't clash.
      const clash = people.slice(1).find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (clash) await q("update people set name = $2 where id = $1", [clash.id, `${clash.name} K`]);
      await q("update people set name = $2 where id = $1", [organizer.id, name]);
      await q("update groups set demo_name = $2 where id = $1", [groupId, name]);
      await setViewer(organizer.id);
      return { ok: true, note: `${name}'s phone is connected.` };
    }
    case "text": {
      if (!sendblueNumber()) return { ok: false, note: "Texting isn't set up on this server." };
      const name = (a.name ?? "").trim().replace(/[^\p{L}' -]/gu, "").slice(0, 20);
      const phone = normalizePhone(a.phone);
      if (!name || !phone) return { ok: false, note: "Add your first name and phone number" };
      const added = await addContact(phone, name);
      if (!added.ok) return { ok: false, note: added.error ?? "Couldn't add your number." };
      const code = String(1000 + Math.floor(Math.random() * 9000));
      await q("update groups set demo_phone = $2, demo_code = $3, demo_phone_name = $4 where id = $1", [groupId, phone, code, name]);
      return { ok: true, note: `Now text JOIN ${code} from that phone.` };
    }
    case "start": {
      if (game) return { ok: false, note: "There's already a game. Start over to make a new one." };
      await setViewer(organizer.id);
      await handleGroupMessage(groupId, organizer.id, SETUP_MESSAGE);
      return { ok: true, note: "Sent the setup message from your phone's account." };
    }
    case "friends": {
      if (!game) return { ok: false, note: "Start the game first." };
      let added = 0;
      for (const [name, line] of FRIENDS) {
        const p = byName(name);
        if (!p) continue;
        const entries = await roster(game.id);
        if (entries.some((e) => e.person_id === p.id && e.status === "in")) continue;
        await handleGroupMessage(groupId, p.id, line);
        const fresh = (await openGameForGroup(groupId)) ?? game;
        const r = await simulatedJoin(fresh, p.id);
        if (!r.error) added++;
      }
      return { ok: true, note: added ? `${added} friends said they're in and placed simulated holds.` : "They're already in." };
    }
    case "player": {
      const jo = byName(PLAYER_ROLE);
      await setViewer(jo.id);
      return { ok: true, note: `Your phone is now ${PLAYER_ROLE}, a player. Tap the game link in the chat to hold a spot with PayPal.` };
    }
    case "organizer": {
      await setViewer(organizer.id);
      return { ok: true, note: "Your phone is the organizer again." };
    }
    case "late": {
      if (!game) return { ok: false, note: "Start the game first." };
      const entries = await roster(game.id);
      const quitter = FRIENDS.map(([n]) => byName(n)).find((p) => p && entries.some((e) => e.person_id === p.id && e.status === "in"));
      if (!quitter) return { ok: false, note: "Add the friends first, so someone can cancel." };
      await moveClock(game, "gameday");
      await handleGroupMessage(groupId, quitter.id, LATE_LINE);
      // The model reads that line, and it can come back unsure and ask "are you out?" instead of
      // acting. The demo's next step needs the late cancel, so make sure it happened.
      const now = await openGameForGroup(groupId);
      const stillIn = now && (await roster(now.id)).some((e) => e.person_id === quitter.id && e.status === "in");
      if (now && stillIn) await playerOut(now, quitter.id);
      await setViewer(organizer.id);
      return { ok: true, note: `It's game day and ${quitter.name} dropped out after free cancel. Your phone is the organizer, deciding what happens to their share.` };
    }
    case "after": {
      if (!game) return { ok: false, note: "Start the game first." };
      await moveClock(game, "over");
      const ran = await runDue((await openGameForGroup(groupId)) ?? game);
      await setViewer(organizer.id);
      return { ok: true, note: ran.includes("Settled the game") ? "The game's over. Everyone who played was charged their share, and the rest of each hold was released." : "Nothing to settle yet." };
    }
  }
}
