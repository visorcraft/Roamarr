import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from 'vitest';
import { PAGE_TITLES } from './pageTitles';

const routesDir = fileURLToPath(new URL('../routes', import.meta.url));

function pageFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return pageFiles(path);
		return entry.name === '+page.svelte' ? [path] : [];
	});
}

function routeId(file: string): string {
	const dir = relative(routesDir, join(file, '..')).split(sep).join('/');
	return dir ? `/${dir}` : '/';
}

// A page whose load always redirects renders nothing, so it needs no title.
function isRedirectStub(file: string): boolean {
	return readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim() === '';
}

const pages = pageFiles(routesDir).map((file) => ({ file, id: routeId(file) }));
const rendered = pages.filter((p) => !isRedirectStub(p.file));

test('the route scan finds the app pages', () => {
	expect(rendered.length).toBeGreaterThan(50);
	expect(rendered.map((p) => p.id)).toContain('/trips/[id]');
});

test.each(rendered.map((p) => p.id))('page %s has a tab title', (id) => {
	expect(PAGE_TITLES[id], `add '${id}' to PAGE_TITLES in src/lib/pageTitles.ts`).toBeTypeOf('function');
});

test('every PAGE_TITLES entry belongs to an existing page', () => {
	const ids = new Set(rendered.map((p) => p.id));
	expect(Object.keys(PAGE_TITLES).filter((id) => !ids.has(id))).toEqual([]);
});

// The root layout owns the only <title>; see the comment in src/routes/+layout.svelte.
test.each(pages.map((p) => [p.id, p.file]))('page %s does not render its own <title>', (_id, file) => {
	expect(readFileSync(file, 'utf8')).not.toMatch(/<title[\s>]/);
});

test.each(Object.keys(PAGE_TITLES))('the page name for %s is a non-empty string', (id) => {
	const name = PAGE_TITLES[id]({});
	expect(typeof name).toBe('string');
	expect(name.trim().length).toBeGreaterThan(0);
});
