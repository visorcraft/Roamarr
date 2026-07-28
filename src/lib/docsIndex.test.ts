import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const docsDir = join(repoRoot, 'docs');
const readmePath = join(repoRoot, 'README.md');
const contributingPath = join(repoRoot, 'CONTRIBUTING.md');
const docsIndexPath = join(docsDir, 'README.md');

function readDoc(path: string): string {
	return readFileSync(path, 'utf-8');
}

function extractMarkdownLinks(body: string): { text: string; href: string }[] {
	const links: { text: string; href: string }[] = [];
	const re = /\[([^\]]+)\]\(([^)]+)\)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) {
		links.push({ text: m[1], href: m[2] });
	}
	return links;
}

function listDocFiles(): string[] {
	return readdirSync(docsDir).filter((name) => name.endsWith('.md'));
}

function resolveLocalLink(sourceDir: string, href: string): string | null {
	const path = href.split(/[?#]/, 1)[0]!;
	if (!path || path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path)) return null;
	return resolve(sourceDir, path);
}

describe('documentation index', () => {
	test('docs/README.md links point to existing markdown files', () => {
		const index = readDoc(docsIndexPath);
		const links = extractMarkdownLinks(index).filter((l) =>
			l.href.startsWith('./')
		);
		expect(links.length).toBeGreaterThan(0);
		for (const link of links) {
			const target = join(docsDir, link.href);
			expect(existsSync(target), `missing doc link target: ${link.href}`).toBe(true);
		}
	});

	test('docs/README.md indexes every public markdown guide', () => {
		const indexed = new Set(
			extractMarkdownLinks(readDoc(docsIndexPath)).map((link) => link.href)
		);
		for (const name of listDocFiles()) {
			if (name === 'README.md') continue;
			expect(indexed.has(`./${name}`), `docs/README.md does not index ${name}`).toBe(true);
		}
	});

	test('README.md links to the user docs index', () => {
		const readme = readDoc(readmePath);
		const links = extractMarkdownLinks(readme);
		const docLinks = links.filter(
			(l) => l.href === 'docs/README.md' || l.href === './docs/README.md'
		);
		expect(docLinks.length).toBeGreaterThan(0);
	});

	test('all relative links inside docs point to existing files', () => {
		for (const name of listDocFiles()) {
			const sourcePath = join(docsDir, name);
			const body = readDoc(sourcePath);
			const links = extractMarkdownLinks(body);
			for (const link of links) {
				const target = resolveLocalLink(docsDir, link.href);
				if (!target) continue;
				expect(existsSync(target), `${name}: missing link target ${link.href}`).toBe(true);
			}
		}
	});

	test('root public docs link only to existing local files', () => {
		for (const sourcePath of [readmePath, contributingPath]) {
			for (const link of extractMarkdownLinks(readDoc(sourcePath))) {
				const target = resolveLocalLink(repoRoot, link.href);
				if (!target) continue;
				expect(existsSync(target), `${sourcePath}: missing link target ${link.href}`).toBe(true);
			}
		}
	});

	test('Phase 7 docs exist', () => {
		const required = [
			'cards.md',
			'travel-documents.md',
			'medications.md',
			'entry-requirements.md',
			'important-items.md',
			'home-tasks.md',
			'journal.md',
			'fare-providers.md',
			'printable-itinerary.md',
			'groups.md'
		];
		const present = new Set(readdirSync(docsDir));
		for (const name of required) {
			expect(present.has(name), `missing required doc: ${name}`).toBe(true);
		}
	});
});
