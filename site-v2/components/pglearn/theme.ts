/*
 * PGLearn colour mode. Kept in a cookie (not localStorage) so the server
 * renders the right class on the first byte and there is no light flash before
 * hydration. Only the platform reads it; the marketing site is always light.
 */
export const THEME_COOKIE = "pglearn-theme";

export type ThemeMode = "light" | "dark";

export function parseTheme(value: string | undefined): ThemeMode {
  return value === "dark" ? "dark" : "light";
}
