import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo Digital Assets Platform",
  description: "Illustrative onboarding and screening demo.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>
            <strong>Demo Digital Assets Platform</strong>
          </Link>
        </header>
        <main>{children}</main>
        <footer className="site-footer">Illustrative demo. Not a regulated compliance system.</footer>
      </body>
    </html>
  );
}
