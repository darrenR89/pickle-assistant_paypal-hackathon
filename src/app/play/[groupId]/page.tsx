import Playground from "./Playground";

export default async function PlayGroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return <Playground groupId={groupId} />;
}
