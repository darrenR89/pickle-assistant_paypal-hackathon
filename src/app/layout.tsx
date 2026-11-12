import type { Metadata, Viewport } from "next";
import "@fontsource/figtree/latin-400.css";
import "@fontsource/figtree/latin-500.css";
import "@fontsource/figtree/latin-600.css";
import "@fontsource/figtree/latin-700.css";
import "@fontsource/figtree/latin-800.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "./globals.css";

export const metadata: Metadata = {
  // Makes link preview image addresses absolute. APP_URL is the public address of the app.
  metadataBase: new URL(process.env.APP_URL ?? "https://getpaddlesin.com"),
  title: "Paddles In",
  description: "An AI assistant in your pickleball group chat. Hold your spot with PayPal or Venmo; after the game each player is charged their real share.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3b2f7a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
