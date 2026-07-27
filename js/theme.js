// cmd2607271542: light/dark theme toggle. The *decision* of which theme to
// start with (stored preference, else prefers-color-scheme) is made by the
// inline script in index.html's <head> -- it must run before first paint to
// avoid a flash of the wrong theme, which this file (loaded near the end of
// body) would be too late for. This file only wires the toggle buttons,
// persists switches, and triggers a tree redraw so its CSS-var-sourced
// palette (see js/tree.js's cssVar()) picks up the new theme immediately.

const THEME_STORAGE_KEY = 'organogenesis-theme';

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  syncThemeButtons(theme);
  // Tree segment/link colors are baked into SVG stroke attributes at draw
  // time, not a live CSS reference -- redraw to pick up the new palette.
  // Reuses the same "redraw with cached data" path already exercised by
  // the orientation/version toggles, so selection/zoom-scale handling is
  // exactly as already tested there.
  if (treeLastData && typeof drawTree === 'function') {
    drawTree(treeLastData);
  }
}

function syncThemeButtons(theme) {
  const lightBtn = document.getElementById('theme-light');
  const darkBtn = document.getElementById('theme-dark');
  if (lightBtn) lightBtn.classList.toggle('is-active', theme === 'light');
  if (darkBtn) darkBtn.classList.toggle('is-active', theme === 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
  syncThemeButtons(document.documentElement.getAttribute('data-theme') || 'light');
  const lightBtn = document.getElementById('theme-light');
  const darkBtn = document.getElementById('theme-dark');
  if (lightBtn) lightBtn.addEventListener('click', () => setTheme('light'));
  if (darkBtn) darkBtn.addEventListener('click', () => setTheme('dark'));
});
