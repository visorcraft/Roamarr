import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import { THEMES } from './themes';

// Light/dark colour variants must follow the SELECTED theme, not the OS preference. `light-dark()`
// looks right but is not: Lightning CSS downlevels it to a polyfill (`--lightningcss-light/-dark`
// set on `html` from `prefers-color-scheme`), so a dark theme on a light OS got the light value
// (dark text on dark chips on the trip page). Instead, app.css gives each readable colour its
// dark-theme value as the default and lets the light theme blocks override it.

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

const LIGHT_OVERRIDES = ['danger-readable', 'warning-text', 'success-text', 'trip-readable'];

const themeBlocks = [...code.matchAll(/([^{}]*)\{([^{}]*--theme-color-scheme:[^{}]*)\}/g)].map(([, selector, body]) => ({
	ids: [...selector.matchAll(/data-theme='([\w-]+)'/g)].map((m) => m[1]),
	scheme: body.match(/--theme-color-scheme:\s*([\w ]+);/)?.[1].trim(),
	defines: new Set([...body.matchAll(/--theme-([\w-]+):/g)].map((m) => m[1]))
}));

test('app.css uses no light-dark() (it follows the OS, not the selected theme)', () => {
	expect(code).not.toContain('light-dark(');
});

test('the theme blocks cover every theme, in both schemes', () => {
	const covered = new Set(themeBlocks.flatMap((b) => b.ids));
	expect(THEMES.map((t) => t.id).filter((id) => !covered.has(id))).toEqual([]);
	expect(themeBlocks.some((b) => b.scheme === 'light')).toBe(true);
	expect(themeBlocks.some((b) => b.scheme === 'dark')).toBe(true);
});

test.each(LIGHT_OVERRIDES)('every light theme block sets --theme-%s, and no dark one does', (name) => {
	const wrong = themeBlocks
		.filter((b) => b.defines.has(name) !== (b.scheme === 'light'))
		.map((b) => `${b.ids.join('/')} (${b.scheme})`);
	expect(wrong).toEqual([]);
});

test.each([
	['--theme-readable-danger', 'danger-readable'],
	['--trip-readable', 'trip-readable'],
	['--trip-readable-strong', 'trip-readable'],
	['--trip-readable-danger', 'trip-readable'],
	['--trip-readable-warning', 'trip-readable'],
	['--trip-readable-success', 'trip-readable']
])('%s defaults to its dark value behind var(--theme-%s, …)', (variable, override) => {
	const defs = [...code.matchAll(new RegExp(`${variable}:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());
	// .trip-hero--map pins its own text to white over the map image; every other definition must
	// go through the theme override.
	const themed = defs.filter((d) => d !== '#fff');
	expect(themed.length).toBeGreaterThan(0);
	for (const d of themed) expect(d).toMatch(new RegExp(`^var\\(--theme-${override}, `));
});

test('the actions menu inside the map hero resets the hero\'s white text and shadow', () => {
	// .trip-hero--map pins --trip-readable to white (with a shadow) for text over the map image;
	// the menu panel is a solid theme colour, so it must go back to the theme's trip colour.
	const rule = code.match(/\.trip-hero--map \.app-user-menu-panel \{([^}]*)\}/)?.[1] ?? '';
	expect(rule).toMatch(/--trip-readable: var\(--theme-trip-readable, /);
	expect(rule).toMatch(/--trip-readable-strong: var\(--theme-trip-readable, /);
	expect(rule).toMatch(/text-shadow: none;/);
});
