export const DARK_MODE_COOKIE_KEY = "isDarkMode";

export function parseDarkModeCookie(value: string | undefined): boolean {
  return value === "true";
}

export function persistDarkMode(isDarkMode: boolean): void {
  document.documentElement.classList.toggle("dark", isDarkMode);
  // One year, so the server-rendered `<html>` class stays in sync on future visits.
  document.cookie = `${DARK_MODE_COOKIE_KEY}=${isDarkMode}; path=/; max-age=31536000`;
}
