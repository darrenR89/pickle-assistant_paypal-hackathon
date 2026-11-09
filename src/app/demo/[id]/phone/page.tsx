import PhoneDemo from "./PhoneDemo";

export const metadata = { title: "Pickleball assistant · your phone" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PhoneDemo id={(await params).id} />;
}
