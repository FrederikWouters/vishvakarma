import type { Metadata } from "next";
import "./globals.css";
import { prisma } from "@/lib/db";
import Sidebar from "@/components/Sidebar";
import { DialogProvider } from "@/components/Dialogs";

export const metadata: Metadata = {
  title: "Vishvakarma",
  description: "A Jira-like project board with swimlanes and tickets",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, key: true },
  });

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            Vishvakarma
          </a>
          <a href="/settings" className="topbar-link">
            Settings
          </a>
        </header>
        <DialogProvider>
          <div className="shell">
            <Sidebar projects={projects} />
            <main>{children}</main>
          </div>
        </DialogProvider>
      </body>
    </html>
  );
}
