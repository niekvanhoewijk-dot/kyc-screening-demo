"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/analyst", label: "Cases", match: (p: string) => p === "/analyst" || p.startsWith("/analyst/cases") },
  { href: "/analyst/simulator", label: "Simulator", match: (p: string) => p.startsWith("/analyst/simulator") },
  { href: "/analyst/audit", label: "Audit trail", match: (p: string) => p.startsWith("/analyst/audit") },
  { href: "/analyst/eval", label: "Evaluation report", match: (p: string) => p.startsWith("/analyst/eval") },
  { href: "/analyst/demo", label: "Demo controls", match: (p: string) => p.startsWith("/analyst/demo") },
];

export function AnalystNavLinks() {
  const path = usePathname() ?? "";
  return (
    <ul className="an-items">
      {ITEMS.map((i) => (
        <li key={i.href}>
          <Link href={i.href} aria-current={i.match(path) ? "page" : undefined}>{i.label}</Link>
        </li>
      ))}
    </ul>
  );
}
