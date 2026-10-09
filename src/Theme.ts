// TODO: modify the preset system
export type ThemePref = "dark" | "system" | "light";

const KEY = "momonga.theme";
const PREFS: ThemePref[] = ["dark", "system", "light"];

export function loadTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY) as ThemePref | null;
    if (v && PREFS.includes(v)) return v;
  } catch {
  }
  return "system";
}

function resolve(pref: ThemePref): "dark" | "light" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return pref;
}

export function applyTheme(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref);
}

export function saveTheme(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
  }
  applyTheme(pref);
}

applyTheme(loadTheme());
window
  .matchMedia("(prefers-color-scheme: light)")
  .addEventListener("change", () => applyTheme(loadTheme()));

window.addEventListener("storage", (e) => {
  if (e.key === KEY) applyTheme(loadTheme());
});