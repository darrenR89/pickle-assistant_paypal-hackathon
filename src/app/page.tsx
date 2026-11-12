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
const VIDEO_ID = process.env.NEXT_PUBLIC_DEMO_VIDEO_ID || "qMzS6yVeeFY"; // YouTube id of the demo video; the env var can override it
const VERTICAL_SRC = process.env.NEXT_PUBLIC_DEMO_VERTICAL_SRC; // vertical MP4 of the phone recording; plays on the 3D phone's screen

// Chapters for the hero player. Times follow the demo plan; set them from the final edit.
const CHAPTERS: Chapter[] = [
  { t: 0, shot: "chat", title: "The organizer texts the group", body: "“@PaddlesIn Thu 6pm Riverside courts 3–4, $64.” Claude turns it into a game: 8 spots, $8 each." },
  { t: 14, shot: "chat", title: "Friends reply like normal", body: "“yeah I’m down” is enough. PaddlesIn counts them in and posts the game link." },
  { t: 28, shot: "game", title: "One tap to hold a spot", body: "Time, courts and the share up front. Players pay with PayPal or Venmo, no app needed." },
  { t: 44, shot: "in", title: "Held, not charged", body: "PayPal authorizes the $8 share plus a small cap. Nothing leaves the account yet." },
  { t: 60, shot: "late", title: "A late cancel, handled fairly", body: "After free cancel ends, the organizer chooses: charge the share or cover it." },
  { t: 75, shot: "paid", title: "Settled after the game", body: "Each player is charged their real share and the rest of every hold is released." },
];

// "How it works": five steps, each with a phone screen, a slogan and two callouts taken from that screen.
const SHOW: Array<ShowcaseStep & { src: string }> = [
  { src: "chat", tab: "Ask the group", title: "Ask for a game, in plain words.", body: "Anyone in the group asks for a game the way they’d text a friend: “@PaddlesIn Thu 6pm Riverside courts 3–4, $64.” Claude makes it a game: 8 spots, $8 each, free cancel until the day before. Friends reply like normal.", chips: ["“in 🙌” counts as in", "Claude reads every reply"] },
  { src: "game", tab: "Join", title: "One tap to hold a spot.", body: "The game link shows the time, the courts and each player’s share. Players tap I’m in and pay with PayPal or Venmo. No app, no account.", chips: ["$8 share each", "No app, no account"] },
  { src: "in", tab: "Hold", title: "Held, not charged.", body: "PayPal authorizes each player’s share plus a small cap. They’re counted in, and nothing leaves their account before the game.", chips: ["$10 on hold", "Charged after the game"] },
  { src: "late", tab: "Late cancel", title: "Late cancels, handled fairly.", body: "After the free cancel period ends, the organizer decides to charge them their share or cover it.", chips: ["Organizer decides", "Charge $8 or cover it"] },
  { src: "paid", tab: "Settle", title: "Charged the real share.", body: "After the game each player is charged their real share and the rest of the hold is released. The organizer sees exactly what was collected.", chips: ["Never more than the hold", "Receipts sent privately"] },
];


// The problem band: the awkward part of collecting money for a game, in three beats.
const PROBLEM: Array<[string, string]> = [
  ["But someone has to do it.", "One person books the court, then has to ask friends for $8 in the group chat. Nobody wants to be that person."],
  ["Not everyone is a friend.", "Sending a payment request to someone you’ve never met feels even worse."],
  ["The host covers the rest.", "When someone drops out the night before, the organizer quietly pays their share."],
];

// "Built to be trusted": what a judge checks first. Every number is backed by the repo (see JUDGES.md):
// 8 PayPal APIs in src/lib/paypal.ts, 101 tests from `pnpm test`.
const PROOF: Proof[] = [
  { n: 0, k: "amounts chosen by the AI", v: "Claude reads the chat. Plain code makes every hold, charge and refund, and a rules parser takes over if Claude is down." },
  { n: 8, k: "PayPal APIs to handle it all", v: "Create order, authorize, void, reauthorize, partial capture, refund, Payouts to the organizer and verified webhooks. Venmo uses the same SDK." },
  { n: 1, k: "charge per payment, even on retry", v: "Every PayPal write sends a PayPal-Request-Id. A settle cut off by a restart is finished by the next scheduled run." },
  { n: 101, k: "tests on every pull request", v: "Money maths, the fallback parser, retries and rate limits, with typecheck, lint and build alongside them in CI." },
];

// Inside the judges' fold: what it's built with, grouped by job.
const STACK: Array<[string, string[]]> = [
  ["App", ["Next.js", "TypeScript", "Postgres", "Render web service", "Render Workflows and cron"]],
  ["Payments", ["PayPal Orders v2", "Authorize, capture, void, refund", "Payouts", "Verified webhooks", "JS SDK with Venmo"]],
  ["AI", ["Claude Haiku 5.5 reads the chat", "Claude Code helped write and review the code"]],
  ["Messaging", ["Real texts through Sendblue"]],
];

// ...and how it came together, day by day (Pacific time), from Darren's hackathon chats and the git history.
const BUILD_DAYS: Array<{ date: string; title: string; notes: string }> = [
  { date: "Fri Nov 6", title: "Research and concept", notes: "Rules, judges and Render Workflows. Two concepts written up; the pickleball one wins." },
  { date: "Sat Nov 7", title: "Rules for the money", notes: "Late cancels, no-shows and called-off games. That night the repo is created and v1 goes live on Render." },
  { date: "Sun Nov 8", title: "First real hold", notes: "First PayPal sandbox hold approved. The group-chat flow is settled, and 5 design directions explored." },
  { date: "Mon Nov 9", title: "The assistant works", notes: "Claude turns a setup text into a game. Simulator, phone demo, first landing page and JUDGES.md." },
  { date: "Tue Nov 10", title: "Money end to end", notes: "Payouts, refunds and verified webhooks. Lint, unit tests and CI on every pull request." },
  { date: "Wed Nov 11", title: "Hardened", notes: "Edge-case review: no overcharge, survives restarts. Accessibility pass, real SMS, Paddles In brand." },
  { date: "Thu Nov 12", title: "Ready for judges", notes: "Late cancels can be charged, covered or wait for a replacement. 2-minute walkthrough and sandbox proof." },
];

// Three highlights, each with a large line icon (24px grid, drawn with strokes in currentColor).
const INFO: Array<{ k: string; v: string; icon: React.ReactNode }> = [
  {
    k: "Where it lives",
    v: "Money handled in the group chats people already use.",
    icon: <><path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /><path d="M19 9h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3h-3" /></>,
  },
  {
    k: "How money moves",
    v: "Payments handled securely through PayPal.",
    icon: <><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20M6 15h4" /></>,
  },
  {
    k: "What it costs",
    v: "No new app, no fee, just pay your share.",
    icon: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.6" /></>,
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
            each one is charged their real share.
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
        <h2 id="problem-h" className="lp-h2">Asking friends to pay you back is awkward. <span className="lp-prob-hi">Asking strangers is <em>worse.</em></span></h2>
        <ul className="lp-beats">
          {PROBLEM.map(([k, v]) => (
            <li key={k}><strong>{k}</strong> {v}</li>
          ))}
        </ul>
        <p className="lp-prob-fix">With Paddles In, everyone’s share is held with PayPal the moment they’re in. <strong>Nobody has to ask.</strong></p>
      </section>

      <section className="lp-section lp-al" id="screens" aria-labelledby="how">
        <AppShowcase
          title="How it works"
          lead="Someone asks the group for a game, friends hold their spot with PayPal, and it settles after the game. Nobody downloads anything: every screen opens from a text."
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
          summary="Four numbers that show how the money stays safe, what it’s built with, and how it came together in seven days."
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
              <ol aria-label="How it was built, day by day">
                {BUILD_DAYS.map((d) => (
                  <li key={d.date}>
                    <span className="lp-build-day">{d.date}</span>
                    <div>
                      <strong>{d.title}</strong>
                      <p>{d.notes}</p>
                    </div>
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
              <a href={`${REPO}/blob/main/JUDGES.md`} target="_blank" rel="noopener noreferrer">For judges</a>
              <a href={`${REPO}/blob/main/docs/PAYPAL.md`} target="_blank" rel="noopener noreferrer">Every PayPal call</a>
              <a href={`${REPO}/blob/main/docs/EDGE-CASES.md`} target="_blank" rel="noopener noreferrer">Every edge case, and how it’s handled</a>
              <a href={`${REPO}#proof-from-a-real-sandbox-run`} target="_blank" rel="noopener noreferrer">Sandbox proof</a>
              <a href={REPO} target="_blank" rel="noopener noreferrer">Source on GitHub (MIT)</a>
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
            <a href={`${REPO}/blob/main/JUDGES.md`} target="_blank" rel="noopener noreferrer" className="lp-btn ghost">For judges</a>
          </div>
        </div>
      </section>

      </main>

      <footer className="lp-foot">
        <Logo className="lp-foot-logo" />
        <span>Built for the PayPal AI Hackathon 2026. Sandbox only: no real money moves.</span>
        <span>
          <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a> · <a href={`${REPO}/blob/main/JUDGES.md`} target="_blank" rel="noopener noreferrer">For judges</a> · <Link href="/play">Full simulator</Link>
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
