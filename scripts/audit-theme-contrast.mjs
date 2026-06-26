import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(__dirname, '../src/app.css');
const css = fs.readFileSync(cssPath, 'utf8');

function hexToRgb(hex) {
	const m = hex.replace('#', '');
	const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
	const int = parseInt(n, 16);
	return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function parseColor(value) {
	const hex = value?.trim();
	if (!hex) return null;
	if (hex.startsWith('#') && (hex.length === 4 || hex.length === 7)) return hexToRgb(hex);
	return null;
}

function luminance({ r, g, b }) {
	const a = [r, g, b].map((v) => {
		v /= 255;
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function contrast(rgb1, rgb2) {
	const l1 = luminance(rgb1) + 0.05;
	const l2 = luminance(rgb2) + 0.05;
	return l1 > l2 ? l1 / l2 : l2 / l1;
}

const themeBlockRe =
	/:where\(\s*\.theme-root\s*,\s*\.theme-preview\s*\)\[data-theme='([^']+)'\]\s*\{([^}]+)\}/g;

const bgVars = ['--theme-canvas', '--theme-surface', '--theme-surface2', '--theme-sidebar'];

const textRoles = [
	{ name: 'ink', var: '--theme-ink' },
	{ name: 'strong', var: '--theme-strong' },
	{ name: 'muted', var: '--theme-muted' },
	{ name: 'brand', var: '--theme-brand' },
	{ name: 'brand-readable', var: '--theme-brand-readable' },
	{ name: 'brand-2', var: '--theme-brand-2' }
];

function extractVars(block) {
	const vars = {};
	const varRe = /--theme-[\w-]+:\s*([^;]+);/g;
	let vm;
	while ((vm = varRe.exec(block)) !== null) {
		const varName = vm[0].split(':')[0].trim();
		vars[varName] = vm[1].trim();
	}
	return vars;
}

const themes = [];
let m;
while ((m = themeBlockRe.exec(css)) !== null) {
	themes.push({ id: m[1], vars: extractVars(m[2]) });
}

// Midnight Travels shares the :root block
const rootBlock = css.match(/:root,\s*[^\{]+\{([^}]+)\}/)?.[1] || '';
const rootVars = extractVars(rootBlock);
const midnight = themes.find((t) => t.id === 'midnight-travels');
if (midnight) Object.assign(midnight.vars, rootVars);

function resolve(varName, themeVars) {
	const val = themeVars[varName];
	if (!val) return null;
	if (val.startsWith('#')) return parseColor(val);
	return null;
}

const issues = [];

for (const theme of themes) {
	for (const role of textRoles) {
		const textRgb = resolve(role.var, theme.vars);
		if (!textRgb) continue;
		for (const bgVar of bgVars) {
			const bgRgb = resolve(bgVar, theme.vars);
			if (!bgRgb) continue;
			const ratio = contrast(textRgb, bgRgb);
			const aaa = ratio >= 7;
			const aa = ratio >= 4.5;
			if (!aaa) {
				issues.push({
					theme: theme.id,
					role: role.name,
					textVar: role.var,
					textVal: theme.vars[role.var],
					bgVar,
					bgVal: theme.vars[bgVar],
					ratio: Number(ratio.toFixed(2)),
					passesAA: aa
				});
			}
		}
	}
}

console.log('Themes audited:', themes.length);
console.log('WCAG AAA failures:', issues.length);

const byTheme = Object.groupBy(issues, (i) => i.theme);
for (const [theme, items] of Object.entries(byTheme).sort((a, b) => a[0].localeCompare(b[0]))) {
	console.log(`\n## ${theme}`);
	for (const item of items) {
		const flag = item.passesAA ? '(passes AA)' : '(FAILS AA)';
		console.log(
			`  ${item.role} ${item.textVal} on ${item.bgVar} ${item.bgVal} = ${item.ratio}:1 ${flag}`
		);
	}
}

if (issues.length === 0) {
	console.log('All text colors meet WCAG AAA against theme backgrounds.');
} else {
	process.exitCode = 1;
}
