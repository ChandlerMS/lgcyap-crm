import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { ExpandCollapseProvider } from "./expand-collapse";

export const metadata: Metadata = {
  title: "Legacy Recruiting Live",
  description: "Private recruiting workspace for Legacy Agency Partners.",
  robots: { index: false, follow: false },
  icons: {
    icon: "/legacy-logo.png",
    shortcut: "/legacy-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ExpandCollapseProvider>{children}</ExpandCollapseProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
