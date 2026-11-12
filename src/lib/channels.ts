// Where a post goes besides the database (which the web playground reads): real texting channels.
import * as sendblue from "@/lib/sendblue";

export async function deliverToGroup(groupId: string, text: string, gameSlug?: string) {
  await sendblue.deliverToGroup(groupId, text, gameSlug);
}

export async function deliverToPerson(groupId: string, personId: string, text: string, gameSlug?: string) {
  await sendblue.deliverToPerson(groupId, personId, text, gameSlug);
}
