/**
 * Theme helper: the console ships dark by default and flips a data-theme
 * attribute on <html>. Kept dependency-free so index.html can run the same
 * lookup inline before the first paint.
 */
export type Theme = "dark" | "light";

const STORAGE_KEY = "oph_theme";

export const getStoredTheme = (): Theme => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

export const applyTheme = (theme: Theme): void => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private-mode browsers can refuse storage; the attribute still applies.
  }
};

export const toggleTheme = (theme: Theme): Theme => (theme === "dark" ? "light" : "dark");
