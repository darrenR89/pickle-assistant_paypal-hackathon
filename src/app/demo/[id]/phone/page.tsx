import ModalFocus from "@/app/ModalFocus";
import PhoneDemo from "./PhoneDemo";

export const metadata = { title: "Paddles In · your phone" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <PhoneDemo id={(await params).id} />
      <ModalFocus />
    </>
  );
}
