"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./cards/icons";

const TABS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/garden", label: "Garden", icon: "sprout" },
  { href: "/shelf", label: "Shelf", icon: "shelf" },
  { href: "/people", label: "People", icon: "people" },
  { href: "/spaces", label: "Spaces", icon: "spaces" },
] as const;

/** Bottom tabs on a phone; a quiet left rail on desktop (shell.css). A person's or a Space's page keeps its tab lit. */
export function TabBar() {
  const path = usePathname();
  const current = (href: string) =>
    path === href ? "page" : href !== "/" && path.startsWith(`${href}/`) ? "true" : undefined;
  // Home has its own search box; /search is the destination itself.
  const showSearch = path !== "/" && path !== "/search" && !path.startsWith("/search/");
  return (
    <>
    {showSearch && (
      <Link className="search-corner" href="/search" aria-label="Search what you heard">
        <Icon name="search" size={22} />
      </Link>
    )}
    <nav className="tabbar" aria-label="Garden sections">
      <ul>
        {TABS.map((t) => (
          <li key={t.href}>
            <Link href={t.href} aria-current={current(t.href)}>
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
    </>
  );
}
