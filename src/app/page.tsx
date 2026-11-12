import type { Metadata } from "next";
import Link from "next/link";
import HeroStage, { type Chapter } from "./landing/HeroStage";
import IslandNav from "./landing/IslandNav";
import Logo from "./Logo";
import AppShowcase, { type ShowcaseStep } from "./landing/AppShowcase";
import CaseStudy from "./landing/CaseStudy";
import ProofCards, { type Proof } from "./landing/ProofCards";
import FinalPhone from "./landing/FinalPhone";
import StatusBar from "./landing/StatusBar";

// Landing page. Humans see the 3D phone and its demo player, the live phone demo and the screens; the same page is
// plain semantic HTML so an AI reading it (or the README / JUDGES.md) gets the facts directly.

// Link preview for the landing page when it is shared (chat apps, the hackathon gallery, social posts).
const SHARE_TITLE = "Pickleball games that settle themselves";
const SHARE_TEXT = "An AI assistant in your group chat. Friends hold their spot with PayPal or Venmo and are charged their real share after the game.";
export const metadata: Metadata = {
  openGraph: {
    type: "website",
    siteName: "Paddles In",
    title: SHARE_TITLE,
    description: SHARE_TEXT,
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "Pickleball games that settle themselves. An AI assistant for your group chat. The game page on a phone shows Thursday 6:00 pm, 4 spots left." }],
  },
  twitter: { card: "summary_large_image", title: SHARE_TITLE, description: SHARE_TEXT, images: ["/og.jpg"] },
};

const REPO = "https://github.com/darrenR89/pickle-assistant_paypal-hackathon";
const VIDEO_ID = process.env.NEXT_PUBLIC_DEMO_VIDEO_ID; // YouTube id, set once the walkthrough is uploaded
const VERTICAL_SRC = process.env.NEXT_PUBLIC_DEMO_VERTICAL_SRC; // vertical MP4 of the phone recording; plays on the 3D phone's screen

// Chapters for the hero player. Times follow the demo plan; set them from the final edit.
const CHAPTERS: Chapter[] = [
  { t: 0, shot: "chat", title: "The organizer texts the group", body: "“@Assistant Thu 6pm Riverside courts 3–4, $64.” Claude turns it into a game: 8 spots, $8 each." },
  { t: 14, shot: "chat", title: "Friends reply like normal", body: "“yeah I’m down” is enough. The assistant counts them in and posts the game link." },
  { t: 28, shot: "game", title: "One tap to hold a spot", body: "Time, courts and the share up front. Players pay with PayPal or Venmo, no app needed." },
  { t: 44, shot: "in", title: "Held, not charged", body: "PayPal authorizes the $8 share plus a small cap. Nothing leaves the account yet." },
  { t: 60, shot: "late", title: "A late cancel, handled fairly", body: "After free cancel ends, the organizer chooses: charge the share or cover it." },
  { t: 75, shot: "paid", title: "Settled after the game", body: "Each player is charged their real share and the rest of every hold is released." },
];

// "How it works": five steps, each with a phone screen, a slogan and two callouts taken from that screen.
const SHOW: Array<ShowcaseStep & { src: string }> = [
  { src: "chat", tab: "Text the group", title: "Say it in the group.", body: "The organizer texts “@Assistant Thu 6pm Riverside courts 3–4, $64.” Claude makes it a game: 8 spots, $8 each, free cancel until the day before. Friends reply like normal.", chips: ["“in 🙌” counts as in", "Claude reads every reply"] },
  { src: "game", tab: "Join", title: "One tap to hold a spot.", body: "The link shows the time, courts and your share. Tap I’m in and pay with PayPal or Venmo. No app, no account.", chips: ["$8 is your share", "No app, no account"] },
  { src: "in", tab: "Hold", title: "Held, not charged.", body: "PayPal authorizes your share plus a small cap. You’re counted in, and nothing leaves your account before the game.", chips: ["$10 on hold", "Charged after the game"] },
  { src: "late", tab: "Late cancel", title: "Late cancels, handled fairly.", body: "After free cancel ends, the organizer decides: charge the share or cover it.", chips: ["Organizer decides", "Charge $8 or cover it"] },
  { src: "paid", tab: "Settle", title: "Charged the real share.", body: "After the game each player is charged their real share and the rest of the hold is released. The organizer sees exactly what was collected.", chips: ["Never more than the hold", "Receipts sent privately"] },
];


// The problem band: three beats of what the organizer goes through today.
const PROBLEM: Array<[string, string]> = [
  ["Pays up front.", "The court is booked and paid for by one person."],
  ["Chases the group.", "Payment requests go out one by one and sit unpaid for days."],
  ["Covers the no-shows.", "Someone drops out the night before, and the organizer pays their share."],
];

// "Built to be trusted": what a judge checks first. Every number is backed by the repo (see JUDGES.md):
// 8 PayPal APIs in src/lib/paypal.ts, 104 tests from `pnpm test`.
const PROOF: Proof[] = [
  { n: 0, k: "amounts chosen by the AI", v: "Claude reads the chat. Plain code makes every hold, charge and refund, and a rules parser takes over if Claude is down." },
  { n: 8, k: "PayPal APIs in a real game", v: "Create order, authorize, void, reauthorize, partial capture, refund, Payouts to the organizer and verified webhooks. Venmo uses the same SDK." },
  { n: 1, k: "charge per payment, even on retry", v: "Every PayPal write sends a PayPal-Request-Id. A settle cut off by a restart is finished by the next scheduled run." },
  { n: 104, k: "tests on every pull request", v: "Money maths, the fallback parser, retries and rate limits, with typecheck, lint and build alongside them in CI." },
];

// Inside the judges' fold: what it's built with, grouped by job.
const STACK: Array<[string, string[]]> = [
  ["App", ["Next.js", "TypeScript", "Postgres", "Render web service", "Render Workflows and cron"]],
  ["Payments", ["PayPal Orders v2", "Authorize, capture, void, refund", "Payouts", "Verified webhooks", "JS SDK with Venmo"]],
  ["AI", ["Claude Haiku 5.5 reads the chat", "Claude Code helped write and review the code"]],
  ["Messaging", ["iMessage through Blooio", "SMS through Sendblue"]],
];

// ...and how it came together, day by day, from the git history (42 pull requests, Nov 9 to 12).
const BUILD_DAYS: Array<{ day: string; date: string; title: string; notes: string[] }> = [
  { day: "Day 1", date: "Mon Nov 9", title: "The assistant works", notes: ["Claude turns a setup text into a game", "Simulator and phone demo", "First landing page and JUDGES.md"] },
  { day: "Day 2", date: "Tue Nov 10", title: "Money end to end", notes: ["Payouts, refunds and verified webhooks", "Lint, unit tests and CI on every PR", "Rounding cents stay with the organizer"] },
  { day: "Day 3", date: "Wed Nov 11", title: "Hardened", notes: ["Edge-case review: no overcharge, survives restarts", "Accessibility pass", "Real iMessage and SMS, Paddles In brand"] },
  { day: "Day 4", date: "Thu Nov 12", title: "Ready for judges", notes: ["Late cancels: charge, cover or wait", "2-minute walkthrough", "Sandbox proof in the README"] },
];

// Each fact gets a large line icon (24px grid, drawn with strokes in currentColor).
const INFO: Array<{ k: string; v: string; icon: React.ReactNode }> = [
  {
    k: "Lives in",
    v: "Your group chat (iMessage and WhatsApp planned)",
    icon: <><path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /><path d="M19 9h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3h-3" /></>,
  },
  {
    k: "Payments",
    v: "PayPal and Venmo, via PayPal Orders v2",
    icon: <><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20M6 15h4" /></>,
  },
  {
    k: "AI",
    v: "Claude (Haiku 5.5) reads every message",
    icon: <g transform="translate(-1.75 0)"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" /></g>,
  },
  {
    k: "Players need",
    v: "No app, no account with us. A text and a link",
    icon: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  },
  {
    k: "Price for players",
    v: "Their share of the court. Nothing more",
    icon: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.6" /></>,
  },
  {
    k: "Status",
    v: "Working prototype in the PayPal sandbox",
    icon: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M7.5 15h9" /></>,
  },
];

export default function Home() {
  return (
    <div className="lp">
      <IslandNav repo={REPO} />
      <main>

      <section className="lp-hero" id="top" aria-labelledby="hero-h">
        <div className="lp-mesh" aria-hidden="true"><i /><i /><i /><i /></div>
        <HeroStage chapters={CHAPTERS} duration={90} videoSrc={VERTICAL_SRC} youtubeId={VIDEO_ID} />
        <div className="lp-grain" aria-hidden="true" />
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">PayPal AI Hackathon 2026 · PayPal sandbox</p>
          <h1 id="hero-h">Pickleball games that settle themselves.</h1>
          <p className="lp-sub">
            An AI assistant that lives in your group chat. Friends say they’re in, hold their spot with PayPal or Venmo, and after the game
            each one is charged their real share. Nobody chases payment requests.
          </p>
          <div className="lp-ctas">
            <Link href="/demo" className="lp-btn">Try the 2-minute walkthrough</Link>
            <a href={VIDEO_ID ? `https://www.youtube.com/watch?v=${VIDEO_ID}` : "#how"} className="lp-btn ghost" data-play-demo="">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>Watch the demo
            </a>
          </div>
          <p className="lp-fine">The 2-minute walkthrough runs on your own phone: you organize, the page plays your friends, and you pay with a PayPal sandbox account.</p>
        </div>
      </section>

      <section className="lp-section lp-al lp-prob" aria-labelledby="problem-h">
        <p className="lp-eyebrow">The problem</p>
        <h2 id="problem-h" className="lp-h2">One friend pays for the court. Then they chase seven people for $8.</h2>
        <ul className="lp-beats">
          {PROBLEM.map(([k, v]) => (
            <li key={k}><strong>{k}</strong> {v}</li>
          ))}
        </ul>
        <p className="lp-prob-fix">With Paddles In, a spot is held with PayPal, not promised in a chat.</p>
      </section>

      <section className="lp-section lp-al" id="screens" aria-labelledby="how">
        <AppShowcase
          title="How it works"
          lead="The organizer texts the group, friends hold their spot with PayPal, and it settles after the game. Nobody downloads anything: every screen opens from a text."
          steps={SHOW.map(({ src: _src, ...step }) => step)}
          phones={SHOW.map((s) => <Phone key={s.src} src={s.src} alt={s.title} eager />)}
        />

        <dl className="lp-info">
          {INFO.map(({ k, v, icon }) => (
            <div key={k}>
              <span className="lp-info-ic" aria-hidden="true">
                <svg viewBox="0 0 24 24">{icon}</svg>
              </span>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="lp-built" id="built" aria-labelledby="built-h">
        <CaseStudy
          eyebrow="For judges"
          title="Built to be trusted"
          summary="Four numbers that show how the money stays safe, what it’s built with, and how it came together in four days."
          thumb={["04", "proofs"]}
          cta="See the proof"
        >
          <ProofCards items={PROOF} />
          <div className="lp-build">
            <div className="lp-build-stack">
              <h3>Built with</h3>
              <dl>
                {STACK.map(([k, items]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{items.map((it) => <span key={it}>{it}</span>)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="lp-build-time">
              <h3>Four days, start to finish</h3>
              <p className="lp-build-sub">42 pull requests, each one through typecheck, lint, tests and build.</p>
              <ol>
                {BUILD_DAYS.map((d) => (
                  <li key={d.day}>
                    <span className="lp-build-day">{d.day} · {d.date}</span>
                    <strong>{d.title}</strong>
                    <ul>{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="lp-trust-foot">
            <p>
              <strong>Real:</strong> Claude reading every message, your own PayPal sandbox hold and capture, and the organizer’s payout.{" "}
              <strong>Simulated:</strong> the other players and their holds, marked SIM-.
            </p>
            <p className="lp-trust-links">
              <a href={`${REPO}/blob/main/JUDGES.md`}>For judges</a>
              <a href={`${REPO}/blob/main/docs/PAYPAL.md`}>Every PayPal call</a>
              <a href={`${REPO}#proof-from-a-real-sandbox-run`}>Sandbox proof</a>
              <a href={REPO}>Source on GitHub (MIT)</a>
            </p>
          </div>
        </CaseStudy>
      </section>

      <section className="lp-final" aria-labelledby="final-h">
        <FinalPhone />
        <h2 id="final-h" className="lp-final-h">
          Run a game <span>from your <span className="lp-nowrap">phone<i className="lp-dot" aria-hidden="true" /></span></span>
        </h2>
        <div className="lp-final-low">
          <p>Scan a code, set up Thursday’s game, and watch it fill, cancel and settle in about two minutes.</p>
          <div className="lp-final-act">
            <Link href="/demo" className="lp-btn">Start the 2-minute walkthrough</Link>
            <a href={`${REPO}/blob/main/JUDGES.md`} className="lp-btn ghost">For judges</a>
          </div>
        </div>
      </section>

      </main>

      <footer className="lp-foot">
        <Logo className="lp-foot-logo" />
        <span>Built for the PayPal AI Hackathon 2026. Sandbox only: no real money moves.</span>
        <span>
          <a href={REPO}>GitHub</a> · <a href={`${REPO}/blob/main/JUDGES.md`}>For judges</a> · <Link href="/play">Full simulator</Link>
        </span>
      </footer>
    </div>
  );
}

// Shots whose top edge is white (chat screens); the rest start on the dark game header.
const LIGHT_TOP = new Set(["chat", "dm"]);

function Phone({ src, alt, eager }: { src: string; alt: string; eager?: boolean }) {
  return (
    <span className="lp-phone">
      <span className={`lp-screen ${LIGHT_TOP.has(src) ? "light" : "dark"}`}>
        <StatusBar />
        <img src={`/shots/${src}.webp`} alt={alt} width={390} height={844} loading={eager ? "eager" : "lazy"} />
      </span>
    </span>
  );
}
