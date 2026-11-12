"use client";

// The iMessage-style message list, shared by the judge's phone and the desktop's copy of the group chat.

export type Person = { id: string; name: string; token: string };
export type Msg = { id: string; sender_id: string | null; dm_to: string | null; text: string; game_slug: string | null };
export type Card = { title: string; subtitle: string; when: string; spots: string };
export type Chat = { people: Person[]; messages: Msg[]; cards: Record<string, Card> };

export default function ChatLog({
  chat,
  list,
  viewerId,
  inGroup,
  linkFor,
  newTab = false,
}: {
  chat: Chat | null;
  list: Msg[];
  viewerId: string;
  inGroup: boolean;
  linkFor: (slugWithQuery: string) => string;
  newTab?: boolean;
}) {
  const people = new Map((chat?.people ?? []).map((p) => [p.id, p]));
  return (
    <>
      {list.map((m) => {
        if (!m.sender_id && / was added to the chat$/.test(m.text)) return <p key={m.id} className="im-system">{m.text}</p>;
        const mine = m.sender_id === viewerId;
        const bot = !m.sender_id;
        const slug = m.game_slug?.split("?")[0];
        const card = slug ? chat?.cards[slug] : undefined;
        const org = m.game_slug?.includes("?o=");
        return (
          <div key={m.id} className={`im-msg ${mine ? "mine" : ""} ${bot ? "bot" : ""}`}>
            {!mine && inGroup && <span className="im-sender">{m.sender_id ? people.get(m.sender_id)?.name : "PaddlesIn"}</span>}
            <div className="im-bubble">
              {m.text}
              {card && m.game_slug && (
                <a className="im-link" href={linkFor(m.game_slug)} {...(newTab ? { target: "_blank", rel: "noreferrer" } : {})}>
                  <span className="im-link-hero">
                    <span className="when">{card.when}</span>
                    <span className="spots">{org ? "organizer" : card.spots}</span>
                  </span>
                  <span className="im-link-meta">
                    <span className="im-link-title">{card.title}</span>
                    <span className="im-link-sub">{org ? "Organizer view · private link" : card.subtitle}</span>
                  </span>
                </a>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
