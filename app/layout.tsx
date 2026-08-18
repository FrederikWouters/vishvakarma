import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vishvakarma",
  description: "A Jira-like project board with swimlanes and tickets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            Vishvakarma
          </a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
