import { newId, newToken, q, tx } from "./db";

// Each visitor to /play gets their own group chat with sample friends, so judges
// testing at the same time never see each other's games.

const CAST = ["Alex", "Sam", "Priya", "Jo", "Mei", "Chris", "Lee"];
/** The player a phone demo switches to, to try paying. */
export const DEMO_PLAYER = "Jo";

const OPENING: Array<[number, string]> = [
  [0, "Anyone up for pickleball this week?"],
  [2, "Thursday evening works for me"],
  [1, "Same, Thursday's good"],
  [0, "Riverside has courts 3–4 at 6. $64 for two hours"],
];

function fakePhone() {
  // 555-01xx numbers are reserved for fiction in the US.
  return `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;
}

/** `extra` adds people after the usual cast (the phone demo needs enough friends to fill a game). */
export async function createPlaygroundGroup(extra: string[] = []) {
  const groupId = newId("grp");
  const people = [...CAST, ...extra].map((name) => ({ id: newId("per"), name, phone: fakePhone(), token: newToken() }));
  await tx(async (c) => {
    await c.query("insert into groups (id, name, playground) values ($1, $2, true)", [groupId, "Thursday crew"]);
    for (const [i, p] of people.entries()) {
      await c.query("insert into people (id, name, phone, token, texts_opt_in) values ($1, $2, $3, $4, true)", [p.id, p.name, p.phone, p.token]);
      await c.query("insert into group_members (group_id, person_id, position) values ($1, $2, $3)", [groupId, p.id, i]);
    }
    for (const [who, text] of OPENING) {
      await c.query("insert into messages (group_id, sender_id, text) values ($1, $2, $3)", [groupId, people[who].id, text]);
    }
  });
  return groupId;
}

export function groupPeople(groupId: string) {
  return q<{ id: string; name: string; phone: string; token: string }>(
    `select p.id, p.name, p.phone, p.token from group_members m join people p on p.id = m.person_id
     where m.group_id = $1 order by m.position, p.created_at`,
    [groupId],
  );
}
