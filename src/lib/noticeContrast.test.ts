import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect } from 'vitest';
import { THEMES } from './themes';

// `.notice-warning` and `.notice-success` text must stay readable on every theme. The text colour
// is `var(--theme-<name>-text, var(--color-<default>))` (see app.css): a Tailwind palette colour
// that a theme block may override. This test resolves it for each theme block and checks WCAG AA
// (4.5:1) against the notice background over each of the theme's page colours.

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const tailwindTheme = readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8');

type Rgb = [number, number, number];
type Lab = [number, number, number];

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const delin = (c: number) => {
	const v = Math.min(Math.max(c, 0), 1);
	return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};

function hexToRgb(hex: string): Rgb {
	let h = hex.replace('#', '');
	if (h.length <= 4) h = [...h].map((c) => c + c).join('');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

function oklabToRgb([L, a, b]: Lab): Rgb {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	].map(delin) as Rgb;
}

/** A Tailwind palette colour (`amber-600`) as sRGB, from tailwindcss/theme.css. */
function tailwind(name: string): Rgb {
	const match = tailwindTheme.match(new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`));
	if (!match) throw new Error(`--color-${name} not found in tailwindcss/theme.css`);
	const [L, C, H] = [Number(match[1]) / 100, Number(match[2]), (Number(match[3]) * Math.PI) / 180];
	return oklabToRgb([L, C * Math.cos(H), C * Math.sin(H)]);
}

// Alpha compositing (a translucent background over the page) happens in sRGB.
const over = (top: Rgb, alpha: number, below: Rgb): Rgb => top.map((v, i) => v * alpha + below[i] * (1 - alpha)) as Rgb;

const luminance = (rgb: Rgb) => {
	const [r, g, b] = rgb.map(lin);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

/** The theme blocks in app.css: the theme ids in each selector, and its colour variables. */
const themeBlocks = [...css.matchAll(/([^{}]*)\{([^{}]*--theme-ink:[^{}]*)\}/g)].map(([, selector, body]) => ({
	ids: [...selector.matchAll(/data-theme='([\w-]+)'/g)].map((m) => m[1]),
	vars: Object.fromEntries([...body.matchAll(/--theme-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}));

/** The default palette colour in `--theme-readable-<name>: var(--theme-<name>-text, var(--color-…))`. */
function readableDefault(name: string): string {
	const match = css.match(
		new RegExp(`--theme-readable-${name}:\\s*var\\(--theme-${name}-text, var\\(--color-([\\w-]+)\\)\\);`)
	);
	if (!match) throw new Error(`--theme-readable-${name} is not var(--theme-${name}-text, var(--color-…))`);
	return match[1];
}

/** A theme block's override, which must itself be a palette colour: `var(--color-amber-800)`. */
function themeOverride(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const match = value.match(/^var\(--color-([\w-]+)\)$/);
	if (!match) throw new Error(`unexpected notice text override: ${value}`);
	return match[1];
}

test('every theme has a parsable colour block', () => {
	const covered = new Set(themeBlocks.flatMap((b) => b.ids));
	expect(THEMES.map((t) => t.id).filter((id) => !covered.has(id))).toEqual([]);
	for (const { vars } of themeBlocks) {
		for (const key of ['canvas', 'surface', 'surface2']) expect(vars[key]).toMatch(/^#[\da-f]{3,8}$/i);
	}
});

test.each([
	['warning', 'amber'],
	['success', 'emerald']
])('.notice-%s takes its text colour from --theme-readable-%s, not a fixed shade', (name) => {
	const rule = css.match(new RegExp(`\\.notice-${name} \\{([^}]*)\\}`))?.[1] ?? '';
	expect(rule).toContain(`color: var(--theme-readable-${name});`);
	expect(rule).not.toMatch(/\btext-[a-z]+-\d{2,3}\b/);
});

test.each([
	['warning', 'amber'],
	['success', 'emerald']
])('.notice-%s text meets WCAG AA on every theme', (name, hue) => {
	const fallback = readableDefault(name);
	const tint = tailwind(`${hue}-500`); // the notice background: <hue>-500 at 10%
	const failures: string[] = [];
	for (const { ids, vars } of themeBlocks) {
		const text = tailwind(themeOverride(vars[`${name}-text`]) ?? fallback);
		for (const page of ['canvas', 'surface', 'surface2']) {
			const ratio = contrast(text, over(tint, 0.1, hexToRgb(vars[page])));
			if (ratio < 4.5) failures.push(`${ids.join('/')} on ${page}: ${ratio.toFixed(2)}:1`);
		}
	}
	expect(failures).toEqual([]);
});
