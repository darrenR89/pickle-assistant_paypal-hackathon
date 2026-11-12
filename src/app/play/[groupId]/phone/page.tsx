import PlayPhone from "./PlayPhone";

export const metadata = { title: "Paddles In · simulator on your phone" };

export default async function Page({ params, searchParams }: { params: Promise<{ groupId: string }>; searchParams: Promise<{ as?: string }> }) {
  const [{ groupId }, { as }] = await Promise.all([params, searchParams]);
  return <PlayPhone groupId={groupId} as={typeof as === "string" ? as : null} />;
}
