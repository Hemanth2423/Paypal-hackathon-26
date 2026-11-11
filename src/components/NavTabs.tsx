"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Connect", href: "/" },
  { label: "Leak Diagnostic", href: "/diagnostic" },
  { label: "Trial", href: null },
  { label: "Results", href: null },
];

export default function NavTabs() {
  const path = usePathname();
  return (
    <ul className="flex gap-1 text-sm">
      {TABS.map((t) => (
        <li key={t.label}>
          {t.href ? (
            <Link
              href={t.href}
              aria-current={path === t.href ? "page" : undefined}
              className={`block whitespace-nowrap rounded-full px-4 py-2 ${path === t.href ? "bg-white/15 font-semibold" : "text-white/85 hover:bg-white/10"}`}
            >
              {t.label}
            </Link>
          ) : (
            <span aria-disabled="true" title="Not built yet" className="block cursor-not-allowed whitespace-nowrap px-4 py-2 text-white/45">
              {t.label}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
