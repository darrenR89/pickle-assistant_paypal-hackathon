import { newId, newToken, one } from "@/lib/db";

/** The person behind a phone number (or Apple ID email), created on their first text. */
export async function personByPhone(phone: string, name?: string) {
  const existing = await one<{ id: string; texts_opt_in: boolean }>("select id, texts_opt_in from people where phone = $1", [phone]);
  if (existing) return existing;
  return (await one<{ id: string; texts_opt_in: boolean }>(
    "insert into people (id, name, phone, token) values ($1, $2, $3, $4) on conflict (phone) do update set phone = excluded.phone returning id, texts_opt_in",
    [newId("per"), (name ?? phone).slice(0, 40), phone, newToken()],
  ))!;
}
