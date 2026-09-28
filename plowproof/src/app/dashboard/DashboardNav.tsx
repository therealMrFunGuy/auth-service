"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Customers" },
  { href: "/dashboard/import", label: "Import" },
  { href: "/dashboard/storms", label: "Storms" },
  { href: "/dashboard/team", label: "Drivers" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function DashboardNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1">
      {LINKS.map((l) => {
        const active = l.href === "/dashboard" ? path === l.href : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded px-3 py-2 font-semibold ${active ? "bg-asphalt text-salt" : "text-asphalt hover:bg-snow"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
