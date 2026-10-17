"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./cards/icons";

// People (the taste ledger) joins with M4-T5; until then no tab points anywhere that does not exist.
const TABS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/garden", label: "Garden", icon: "sprout" },
  { href: "/shelf", label: "Shelf", icon: "shelf" },
] as const;

/** Bottom tabs on a phone; a quiet left rail on desktop (shell.css). */
export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="Garden sections">
      <ul>
        {TABS.map((t) => (
          <li key={t.href}>
            <Link href={t.href} aria-current={path === t.href ? "page" : undefined}>
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
