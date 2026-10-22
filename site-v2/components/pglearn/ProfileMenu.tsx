"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Moon, Settings, Sun } from "lucide-react";
import { THEME_COOKIE, type ThemeMode } from "./theme";

/*
 * The account menu on the right of the top bar: Settings, light/dark mode and
 * Sign out, plus any platform-admin destinations. A disclosure button that
 * opens a small `surface` panel (hairline, `radius-m`, no shadow); Escape or a
 * click elsewhere closes it and returns focus to the button.
 *
 * Signing out is a form posting to the server action passed in, so it works as
 * a plain request and is never a link.
 */
export function ProfileMenu({
  name,
  email,
  initialTheme,
  signOut,
  adminLinks = [],
}: {
  name: string;
  email: string;
  initialTheme: ThemeMode;
  signOut: () => Promise<void>;
  adminLinks?: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>(initialTheme);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const next: ThemeMode = mode === "dark" ? "light" : "dark";

  // The wrapper, not <html>, carries the class, so the mode never reaches the
  // marketing pages that share the root layout.
  function toggleTheme() {
    document.querySelector(".pglearn")?.classList.toggle("dark", next === "dark");
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setMode(next);
  }

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";

  const item =
    "flex w-full items-center gap-3 rounded-ui-sm px-3 py-2.5 text-left font-ui text-ui-body text-ui-foreground transition-colors hover:bg-ui-wash";

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 items-center gap-2 rounded-full border border-ui-border bg-ui-card pl-1 pr-3 transition-colors hover:bg-ui-wash"
      >
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-full bg-ui-primary font-ui text-ui-caption font-semibold text-ui-primary-foreground"
        >
          {initials}
        </span>
        <span className="sr-only">Account menu for </span>
        <span className="hidden max-w-[12rem] truncate font-ui text-ui-button text-ui-foreground sm:inline">
          {name}
        </span>
        <ChevronDown aria-hidden className="size-4 text-ui-muted-foreground" />
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-2 w-64 rounded-ui border border-ui-border bg-ui-popover p-2 text-ui-popover-foreground"
      >
        <div className="border-b border-ui-border px-3 pb-3 pt-1">
          <p className="truncate font-ui text-ui-button text-ui-foreground">{name}</p>
          <p className="truncate text-ui-caption text-ui-muted-foreground">{email}</p>
        </div>

        <nav aria-label="Account" className="flex flex-col py-1">
          <Link href="/settings" className={item} onClick={() => setOpen(false)}>
            <Settings aria-hidden className="size-4" />
            Settings
          </Link>
          {adminLinks.map((link) => (
            <Link key={link.href} href={link.href} className={item} onClick={() => setOpen(false)}>
              <span aria-hidden className="size-4" />
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-col border-t border-ui-border pt-1">
          <button type="button" onClick={toggleTheme} className={item}>
            {mode === "dark" ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
            {mode === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <form action={signOut}>
            <button type="submit" className={item}>
              <LogOut aria-hidden className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
