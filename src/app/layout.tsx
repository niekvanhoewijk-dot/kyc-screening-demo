import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo Digital Assets Platform",
  description: "Illustrative onboarding and screening demo. Synthetic data only.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>
            <strong>Demo Digital Assets Platform</strong>
          </Link>
          <span className="pill" title="Not a real service">Illustrative demo</span>
        </header>
        <main>{children}</main>
        <footer className="site-footer">Illustrative demo. Not a regulated compliance system. Synthetic data only: never enter real personal data or documents.</footer>
      </body>
    </html>
  );
}
