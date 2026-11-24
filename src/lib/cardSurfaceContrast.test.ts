import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import { THEMES } from './themes';

// Card surfaces (the notifications page, TripCard, the dashboard, the public share page, and the
// trip edit page) paint text and status colours from theme tokens, not fixed Tailwind palette classes.
// This test checks the source uses those tokens, and
// that every theme block defines them readable on both --theme-surface and --theme-surface2.

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const notifications = readFileSync(new URL('../routes/notifications/+page.svelte', import.meta.url), 'utf8');
const tripCard = readFileSync(new URL('./components/TripCard.svelte', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../routes/+page.svelte', import.meta.url), 'utf8');
const share = readFileSync(new URL('../routes/share/[token]/+page.svelte', import.meta.url), 'utf8');
const tripEdit = readFileSync(new URL('../routes/trips/[id]/edit/+page.svelte', import.meta.url), 'utf8');

type Rgb = [number, number, number];

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hexToRgb(hex: string): Rgb {
	let h = hex.replace('#', '');
	if (h.length <= 4) h = [...h].map((c) => c + c).join('');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

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

test('no fixed palette classes on card surfaces', () => {
	for (const [name, source] of [
		['notifications', notifications],
		['TripCard', tripCard],
		['dashboard', dashboard],
		['share', share],
		['trip edit', tripEdit]
	] as const) {
		expect(source, `${name} must not use fixed palette classes`).not.toMatch(
			/\b(?:text|bg)-(?:white|slate-\d{2,3}|indigo-\d{2,3})\b/
		);
	}
});

test('notifications page uses theme tokens', () => {
	expect(notifications).toContain('text-[var(--theme-ink)]');
	expect(notifications).toContain('text-[var(--theme-muted)]');
	const dot = notifications.match(/<span[^>]*rounded-full[^>]*>/)?.[0] ?? '';
	expect(dot).toContain('aria-hidden="true"');
	expect(dot).toContain('bg-[var(--theme-line)]');
	expect(dot).toContain('bg-[var(--theme-brand)]');
});

test('TripCard uses theme tokens', () => {
	expect(tripCard.match(/text-\[var\(--theme-muted\)\]/g)?.length).toBe(3);
	expect(tripCard).not.toMatch(/text-slate-/);
});

test('dashboard uses theme tokens', () => {
	// The stat value is text-4xl extrabold (large text), so the >= 3:1 floor that
	// 'theme tokens are readable on every theme surface' enforces for brand applies.
	expect(dashboard).toContain("accent: 'text-[var(--theme-brand)]'");
	expect(dashboard).toContain('class="metric-label group-hover:text-[var(--theme-ink)]"');
	expect(dashboard).toContain(`<p class="mt-1 text-sm text-[var(--theme-ink)]">{a.body ?? ''}</p>`);
	expect(dashboard).toContain(`<p class="mt-0.5 text-xs text-[var(--theme-muted)]">by {a.displayName ?? 'Unknown'}</p>`);
});

test('public share page uses theme tokens', () => {
	expect(share).toContain('class="text-xs font-medium tracking-wide text-brand uppercase"');
	expect(share).toContain(`<Icon name="location" class="h-4 w-4 shrink-0 text-muted" />`);
	expect(share).toContain('<span class="font-mono text-xs text-muted">');
	expect(share).not.toMatch(/text-(?:slate|indigo)-\d/);
});

test('trip edit page themes its status hint', () => {
	expect(tripEdit).toContain('<p class="mt-1 text-sm text-muted">Dates in your timezone show this trip as');
	expect(tripEdit).not.toMatch(/text-slate-/);
});

test('theme tokens are readable on every theme surface', () => {
	const covered = new Set(themeBlocks.flatMap((b) => b.ids));
	expect(THEMES.map((t) => t.id).filter((id) => !covered.has(id))).toEqual([]);
	const failures: string[] = [];
	for (const { ids, vars } of themeBlocks) {
		const label = ids.join('/');
		for (const bg of ['surface', 'surface2'] as const) {
			const bgHex = vars[bg];
			if (!bgHex || !/^#[\da-f]{3,8}$/i.test(bgHex)) {
				failures.push(`${label} ${bg}: ${bgHex}`);
				continue;
			}
			const bgRgb = hexToRgb(bgHex);
			for (const [token, min] of [
				['ink', 4.5],
				['muted', 4.5],
				['brand', 3.0]
			] as const) {
				const value = vars[token];
				if (!value || !/^#[\da-f]{3,8}$/i.test(value)) {
					failures.push(`${label} ${token}: ${value}`);
					continue;
				}
				const ratio = contrast(hexToRgb(value), bgRgb);
				if (ratio < min) failures.push(`${label} ${token} on ${bg}: ${ratio.toFixed(2)}:1`);
			}
		}
		const line = vars['line'];
		// high-contrast uses an opaque line by design (the New badge carries the unread state)
		const lineShape = ids.includes('high-contrast') ? /^#[\da-f]{6,8}$/i : /^#[\da-f]{8}$/i;
		if (!line || !lineShape.test(line)) failures.push(`${label} line: ${line}`);
	}
	expect(failures).toEqual([]);
});
