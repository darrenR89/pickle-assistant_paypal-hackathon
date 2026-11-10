import Link from "next/link";

// Landing page. Humans see the video, the live phone demo and the screens; the same page is
// plain semantic HTML so an AI reading it (or the README / JUDGES.md) gets the facts directly.

const REPO = "https://github.com/darrenR89/pickle-assistant_paypal-hackathon";
const VIDEO_ID = process.env.NEXT_PUBLIC_DEMO_VIDEO_ID; // YouTube id, set once the walkthrough is uploaded

const SCREENS = [
  { src: "chat", title: "Say it in the group", body: "“yeah I’m down” is enough. The assistant reads the chat and replies with the game link." },
  { src: "game", title: "One tap to hold a spot", body: "Time, courts and your share up front. Tap I’m in and pay with PayPal or Venmo." },
  { src: "partners", title: "Know the format", body: "Rotating or fixed partners, level, indoor or outdoor, so nobody shows up surprised." },
  { src: "in", title: "Held, not charged", body: "PayPal holds your share plus a small cap. Nothing leaves your account before the game." },
  { src: "late", title: "Late cancels, handled fairly", body: "After free cancel ends, the organizer decides: charge the share or cover it." },
  { src: "paid", title: "Charged the real share", body: "After the game each player pays their share. The rest of the hold is released." },
  { src: "dm", title: "Money talk stays private", body: "Holds, receipts and refunds go to each player privately, never to the group." },
];

const INFO: Array<[string, string]> = [
  ["Lives in", "Your group chat (iMessage and WhatsApp planned)"],
  ["Payments", "PayPal and Venmo, via PayPal Orders v2"],
  ["AI", "Claude (Haiku 5.5) reads every message"],
  ["Players need", "No app, no account with us. A text and a link"],
  ["Price for players", "Their share of the court. Nothing more"],
  ["Status", "Working prototype in the PayPal sandbox"],
];

export default function Home() {
  return (
    <div className="lp">
      <nav className="lp-nav" aria-label="Main">
        <Link href="/" className="lp-logo">
          <span className="lp-ball" aria-hidden="true" /> Pickleball assistant
        </Link>
        <div className="lp-navlinks">
          <a href="#screens">The app</a>
          <a href="#built">How it was built</a>
          <a href={REPO}>GitHub</a>
          <Link href="/demo" className="lp-navcta">Try it on your phone</Link>
        </div>
      </nav>

      <header className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">PayPal AI Hackathon 2026 · PayPal sandbox</p>
          <h1>Pickleball games that settle themselves.</h1>
          <p className="lp-sub">
            An AI assistant that lives in your group chat. Friends say they’re in, hold their spot with PayPal or Venmo, and after the game
            each one is charged their real share. Nobody chases payment requests.
          </p>
          <div className="lp-ctas">
            <Link href="/demo" className="lp-btn">Try it live on your phone</Link>
            <a href="#video" className="lp-btn ghost">Watch the demo</a>
          </div>
          <p className="lp-fine">The live demo runs on your own phone: you organize, the page plays your friends, and you pay with a PayPal sandbox account.</p>
        </div>

        <div className="lp-hero-media" id="video">
          {VIDEO_ID ? (
            <div className="lp-video">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0`}
                title="Pickleball assistant demo video"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="lp-trio" aria-label="The app on a phone">
              <Phone src="chat" alt="Group chat where friends reply and the assistant posts the game link" />
              <Phone src="game" alt="Game page with the time, spots left and an I'm in button" />
              <Phone src="paid" alt="Receipt showing the player paid their share after the game" />
            </div>
          )}
        </div>
      </header>

      <section className="lp-section" aria-labelledby="how">
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

      <section className="lp-section" id="screens" aria-labelledby="screens-h">
        <h2 id="screens-h" className="lp-h2">The app</h2>
        <p className="lp-lead">Players never download anything. Everything below is a web page that opens from a text.</p>
        <ul className="lp-gallery">
          {SCREENS.map((s) => (
            <li key={s.src}>
              <Phone src={s.src} alt={s.title} />
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ul>

        <dl className="lp-info">
          {INFO.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="lp-built" id="built" aria-labelledby="built-h">
        <div className="lp-built-in">
          <p className="lp-eyebrow">Case study</p>
          <h2 id="built-h" className="lp-h2 light">How this was built</h2>

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
                relies on color alone. The game page went through many rounds, with the time as the hero and money explained in plain words. Patterns
                came from studying event and payment apps on Mobbin, then were redrawn from scratch.
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
        </div>
      </section>

      <section className="lp-final" aria-labelledby="final-h">
        <h2 id="final-h" className="lp-h2">Run a game from your phone</h2>
        <p className="lp-lead">Scan a code, set up Thursday’s game, and watch it fill, cancel and settle in about two minutes.</p>
        <Link href="/demo" className="lp-btn">Open the live demo</Link>
      </section>

      <footer className="lp-foot">
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

function Phone({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="lp-phone">
      <span className={`lp-screen ${LIGHT_TOP.has(src) ? "light" : "dark"}`}>
        <StatusBar />
        <img src={`/shots/${src}.webp`} alt={alt} width={390} height={844} loading="lazy" />
      </span>
    </span>
  );
}

/** iOS-style status bar (time, Dynamic Island, signal, Wi-Fi, battery) so the shots read as a phone. */
function StatusBar() {
  return (
    <span className="lp-status" aria-hidden="true">
      <span className="lp-status-time">9:41</span>
      <span className="lp-status-island" />
      <span className="lp-status-icons">
        <svg viewBox="0 0 18 12" width="18" height="12">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12" width="16" height="12">
          <path d="M8 2.6c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .8C5.2.8 2.7 1.9.8 3.7L2 5c1.6-1.5 3.7-2.4 6-2.4Z" />
          <path d="M8 6.2c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4.4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Z" />
          <path d="M8 9.8 9.9 8A2.8 2.8 0 0 0 6.1 8L8 9.8Z" transform="translate(0 1)" />
        </svg>
        <svg viewBox="0 0 27 13" width="27" height="13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" strokeOpacity=".4" />
          <rect x="2" y="2" width="20" height="9" rx="2.5" />
          <path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" fillOpacity=".4" />
        </svg>
      </span>
    </span>
  );
}
