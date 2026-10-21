import type { Metadata } from "next";
import { Alexandria } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Design font (docs/design brief). next/font downloads it once at build/dev time and serves it locally.
const alexandria = Alexandria({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-alexandria", display: "swap" });

export const metadata: Metadata = {
  title: "Demo Digital Assets Platform",
  description: "Illustrative onboarding and screening demo. Synthetic data only.",
  robots: { index: false, follow: false },
};

// Applicant and analyst sections render their own frames (LeftPanel / AnalystNav), each carrying
// the demo footer line.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={alexandria.variable}>
      <body>{children}</body>
    </html>
  );
}
