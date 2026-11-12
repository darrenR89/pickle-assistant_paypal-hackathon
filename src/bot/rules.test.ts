import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type GroupContext, resolveMember, withRules } from "@/bot/agent";
import { parseGameRequest, toHalfHour, zonedTime } from "@/bot/parse";

const ctx = (over: Partial<GroupContext> = {}): GroupContext => ({
  game: undefined,
  sender: { id: "per_1", name: "Sam" },
  isOrganizer: false,
  members: ["Alex", "Sam", "Dana", "Lee"],
  inNames: [],
  waitlist: [],
  invited: [],
  recent: [],
  ...over,
});
const action = (text: string, over?: Partial<GroupContext>) => withRules(ctx(over), text).action;

describe("withRules (the fallback when Claude is unavailable)", () => {
  it("reads joins", () => {
    for (const t of ["in", "I'm in", "count me in", "im down", "+1", "yeah I'm down", "yes, in", "ok count me in"]) assert.equal(action(t), "join", t);
  });
  it("reads drop-outs", () => {
    for (const t of ["can't make it", "I'm out", "out", "have to bail"]) assert.equal(action(t), "leave", t);
  });
  it("reads maybes and waitlist", () => {
    assert.equal(action("maybe if work lets out"), "maybe");
    assert.equal(action("put me on the waitlist"), "waitlist");
    assert.equal(action("waitlist me"), "waitlist");
  });
  it("names who gets a spot", () => {
    const d = withRules(ctx(), "can Lee take my spot?");
    assert.equal(d.action, "give_spot");
    assert.equal(d.target, "Lee");
  });
  it("only lets the organizer invite a member by name", () => {
    assert.equal(action("add Jordan", { isOrganizer: true }), "invite");
    assert.notEqual(action("add Jordan"), "invite");
  });
  it("sends money questions to a private reply", () => {
    assert.equal(action("did I pay for thursday?"), "private_money");
  });
  it("ignores small talk and late notices", () => {
    assert.equal(action("running 10 late"), "ignore");
    assert.equal(action("great game last week"), "ignore");
  });
});

describe("resolveMember", () => {
  const members = ["Alex", "Alexis", "Dana"];
  it("prefers an exact match", () => assert.deepEqual(resolveMember(members, "alex"), { status: "one", name: "Alex" }));
  it("accepts a unique prefix", () => assert.deepEqual(resolveMember(members, "Dan"), { status: "one", name: "Dana" }));
  it("asks when a prefix is ambiguous", () => assert.equal(resolveMember(members, "Ale").status, "many"));
  it("reports unknown and missing names", () => {
    assert.equal(resolveMember(members, "Kim").status, "none");
    assert.equal(resolveMember(members, undefined).status, "missing");
  });
});

describe("times", () => {
  it("rounds game times to the hour or half hour", () => {
    assert.equal(toHalfHour(new Date("2026-11-12T02:10:00Z")).toISOString(), "2026-11-12T02:00:00.000Z");
    assert.equal(toHalfHour(new Date("2026-11-12T02:20:00Z")).toISOString(), "2026-11-12T02:30:00.000Z");
    assert.equal(toHalfHour(new Date("2026-11-12T02:29:00Z"), "floor").toISOString(), "2026-11-12T02:00:00.000Z");
  });
  it("reads wall-clock times in Pacific time across daylight saving", () => {
    assert.equal(zonedTime(2026, 11, 12, 18, 0).toISOString(), "2026-11-13T02:00:00.000Z"); // PST, UTC-8
    assert.equal(zonedTime(2026, 7, 9, 18, 0).toISOString(), "2026-07-10T01:00:00.000Z"); // PDT, UTC-7
  });
});

describe("parseGameRequest without Claude", () => {
  it("turns a setup message into a game", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const now = new Date("2026-11-10T17:00:00Z"); // Tuesday morning in Pacific time
      const g = await parseGameRequest("@Assistant Thu 6pm Riverside courts 3-4, 8 spots, $64", now);
      assert.equal(g.startsAt?.toISOString(), "2026-11-13T02:00:00.000Z");
      assert.equal(g.spots, 8);
      assert.equal(g.priceCents, 6400);
      assert.match(g.place ?? "", /Riverside/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
