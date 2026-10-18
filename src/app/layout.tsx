import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Demo Digital Assets Platform",
  description: "Illustrative onboarding and screening demo.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <header style={{ padding: "16px 24px", borderBottom: "1px solid #ddd" }}>
          <strong>Demo Digital Assets Platform</strong>
        </header>
        <main style={{ flex: 1, padding: "24px" }}>{children}</main>
        <footer style={{ padding: "12px 24px", borderTop: "1px solid #ddd", fontSize: 13, color: "#555" }}>
          Illustrative demo. Not a regulated compliance system.
        </footer>
      </body>
    </html>
  );
}
