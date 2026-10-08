"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/pglearn/ui/button";
import { THEME_COOKIE, type ThemeMode } from "./theme";

/*
 * Flips the `.dark` class on the `.pglearn` wrapper and remembers the choice
 * for a year. The wrapper, not <html>, carries the class, so the mode can never
 * leak into the marketing pages that share the root layout.
 */
export function ThemeToggle({ initial }: { initial: ThemeMode }) {
  const [mode, setMode] = useState<ThemeMode>(initial);
  const next: ThemeMode = mode === "dark" ? "light" : "dark";

  function toggle() {
    document.querySelector(".pglearn")?.classList.toggle("dark", next === "dark");
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setMode(next);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {mode === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
