// TODO: modify the preset system
export type ThemePref = "dark" | "system" | "light";

const KEY = "momonga.theme";
const PREFS: ThemePref[] = ["dark", "system", "light"];

export function loadTheme(): ThemePref {
  
  const v = localStorage.getItem(KEY) as ThemePref | null;
  if (v && PREFS.includes(v)) return v;
  return "system";
}

function resolve(pref: ThemePref): "dark" | "light" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return pref;
}

function applyTheme(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref);
}

export function saveTheme(pref: ThemePref) {
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
}

applyTheme(loadTheme());
window
  .matchMedia("(prefers-color-scheme: light)")
  .addEventListener("change", () => applyTheme(loadTheme()));

window.addEventListener("storage", (e) => {
  if (e.key === KEY) applyTheme(loadTheme());
});