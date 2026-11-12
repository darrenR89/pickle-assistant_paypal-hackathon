import type { Metadata } from "next";
import Link from "next/link";
import HeroStage, { type Chapter } from "./landing/HeroStage";
import IslandNav from "./landing/IslandNav";
import Logo from "./Logo";
import AppShowcase, { type ShowcaseStep } from "./landing/AppShowcase";
import CaseStudy from "./landing/CaseStudy";
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

// "The app" section: five steps, each with a phone screen, a slogan and two callouts taken from that screen.
const SHOW: Array<ShowcaseStep & { src: string }> = [
  { src: "chat", tab: "Chat", title: "Say it in the group.", body: "“yeah I’m down” is enough. The assistant reads the chat and replies with the game link.", chips: ["“in 🙌” counts as in", "Claude reads every reply"] },
  { src: "game", tab: "Join", title: "One tap to hold a spot.", body: "Time, courts and your share up front. Tap I’m in and pay with PayPal or Venmo.", chips: ["$8 is your share", "No app, no account"] },
  { src: "in", tab: "Hold", title: "Held, not charged.", body: "PayPal holds your share plus a small cap. Nothing leaves your account before the game.", chips: ["$10 on hold", "Charged after the game"] },
  { src: "late", tab: "Late cancel", title: "Late cancels, handled fairly.", body: "After free cancel ends, the organizer decides: charge the share or cover it.", chips: ["Organizer decides", "Charge $8 or cover it"] },
  { src: "paid", tab: "Settle", title: "Charged the real share.", body: "After the game each player pays their share. The rest of the hold is released.", chips: ["Never more than the hold", "Receipts sent privately"] },
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
    icon: <><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" /></>,
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

      <section className="lp-section lp-al" aria-labelledby="how">
        <h2 id="how" className="lp-h2">How it works</h2>
        <ol className="lp-steps">
          <li>
            <span className="lp-n">1</span>
            <h3>The organizer texts the group</h3>
            <p>“@Assistant Thu 6pm Riverside courts 3–4, $64.” Claude turns that into a game: 8 spots, $8 each, free cancel until the day before.</p>
          </li>
          <li>
            <span className="lp-n">2</span>
            <h3>Players hold their spot</h3>
            <p>Tapping the link and I’m in places a PayPal authorization for the share plus a small cap. It counts you in without charging you.</p>
          </li>
          <li>
            <span className="lp-n">3</span>
            <h3>It settles after the game</h3>
            <p>Each player is captured for their real share and the rest of each hold is released. The organizer sees exactly what was collected.</p>
          </li>
        </ol>
      </section>

      <section className="lp-section lp-al" id="screens" aria-labelledby="screens-h">
        <AppShowcase
          title="The app"
          lead="Players never download anything. Every screen is a web page that opens from a text."
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
        <CaseStudy summary="Five short chapters: the problem, how Claude reads the chat, the PayPal money flow, the design and how it was tested.">

          <article className="lp-ch">
            <span className="lp-chn">01</span>
            <div>
              <h3>The problem</h3>
              <p>
                Rec pickleball runs on group chats. One person books the court and pays up front, then chases everyone for their share. People
                say “maybe”, drop out the night before, or never pay. The organizer ends up out of pocket, and asking for money in the group feels
                awkward.
              </p>
            </div>
          </article>

          <article className="lp-ch">
            <span className="lp-chn">02</span>
            <div>
              <h3>The AI: reads the chat, never moves money</h3>
              <p>
                Claude reads every message with forced tool calls. One turns a setup message into game details. Another decides what a reply
                means: in, out, maybe, waitlist, give my spot to Lee, or a question for the host. If the request is vague, it starts a draft and
                asks the organizer privately. Questions like “is there parking?” go to the host, not the whole group.
              </p>
              <p>
                The rule throughout: the AI only works out what people mean. Every hold, charge and release is plain, deterministic code. If
                Claude is unavailable, a rules-based parser keeps things working.
              </p>
            </div>
          </article>

          <article className="lp-ch">
            <span className="lp-chn">03</span>
            <div>
              <h3>The money: authorize now, capture later</h3>
              <ul className="lp-flow" aria-label="PayPal payment flow">
                <li><strong>Hold</strong><span>Orders v2 with intent AUTHORIZE. Share plus a small cap.</span></li>
                <li><strong>Release</strong><span>Void the authorization when someone cancels in time.</span></li>
                <li><strong>Renew</strong><span>Reauthorize holds past PayPal’s 3-day honor period, so they’re good on game day.</span></li>
                <li><strong>Charge</strong><span>Capture only the real share after the game. The rest is released.</span></li>
              </ul>
              <p>
                Every payment call carries a PayPal-Request-Id so retries never double charge. Venmo appears through the same PayPal JS SDK. A player can
                never pay more than the hold they approved.
              </p>
            </div>
          </article>

          <article className="lp-ch">
            <span className="lp-chn">04</span>
            <div>
              <h3>The design</h3>
              <p>
                Pickleball skews older, so the floor was set first: body text 17px or larger, 7:1 contrast, 56px buttons, and nothing that
                relies on color alone. The game page went through many rounds, with the time as the hero and money explained in plain words. Its layout
                borrows from event invites like Partiful and Eventbrite, redrawn from scratch.
              </p>
            </div>
          </article>

          <article className="lp-ch">
            <span className="lp-chn">05</span>
            <div>
              <h3>Testing it without a real group</h3>
              <p>
                A simulator plays a full group chat, with controls to add people, fill the game and move the clock. The phone demo builds on it so
                anyone can run a game from their own phone. What’s real: Claude reading every message, and your own PayPal sandbox hold and
                capture. What’s simulated: the other players and their holds, which are clearly marked.
              </p>
            </div>
          </article>

          <p className="lp-stack">
            Built with Next.js, TypeScript and Postgres on Render · PayPal Orders v2 and the PayPal JS SDK · Claude Haiku 5.5 by Anthropic ·{" "}
            <a href={REPO}>Source on GitHub</a> (MIT)
          </p>
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
