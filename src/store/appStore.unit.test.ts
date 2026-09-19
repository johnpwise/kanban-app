import { beforeEach, describe, expect, it } from "vitest";

import { DARK_MODE_COOKIE_KEY, parseDarkModeCookie, persistDarkMode } from "./appStore";

function clearDarkModeCookie(): void {
  document.cookie = `${DARK_MODE_COOKIE_KEY}=; path=/; max-age=0`;
}

describe("parseDarkModeCookie", () => {
  it("should return true only for the string \"true\"", () => {
    expect(parseDarkModeCookie("true")).toBe(true);
    expect(parseDarkModeCookie("false")).toBe(false);
    expect(parseDarkModeCookie(undefined)).toBe(false);
  });
});

describe("persistDarkMode", () => {
  beforeEach(() => {
    clearDarkModeCookie();
    document.documentElement.classList.remove("dark");
  });

  it("should toggle the html element's dark class and persist the cookie", () => {
    // Act
    persistDarkMode(true);

    // Assert
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain(`${DARK_MODE_COOKIE_KEY}=true`);

    // Act
    persistDarkMode(false);

    // Assert
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.cookie).toContain(`${DARK_MODE_COOKIE_KEY}=false`);
  });
});
