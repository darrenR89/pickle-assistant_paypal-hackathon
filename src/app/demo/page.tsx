import DemoRemote from "./DemoRemote";

export const metadata = {
  title: "Live demo on your phone · Paddles In",
  description: "Scan a QR code and run a pickleball game from your own phone as the organizer, while this page plays the rest of the group chat.",
};

export default function Page() {
  return <DemoRemote />;
}
