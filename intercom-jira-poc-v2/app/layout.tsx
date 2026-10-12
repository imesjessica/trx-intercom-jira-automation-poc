import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Support to Engineering Handoff | POC",
  description: "Proof of concept: tag an Intercom ticket and push it to Jira.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
