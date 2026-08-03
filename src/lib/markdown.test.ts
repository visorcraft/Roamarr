import { describe, test, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('escaping (XSS safety)', () => {
	test('escapes HTML tags', () => {
		expect(renderMarkdown('<script>alert(1)</script>')).toBe(
			'<p class="leading-relaxed">&lt;script&gt;alert(1)&lt;/script&gt;</p>'
		);
	});

	test('escapes img onerror and other event-handler markup', () => {
		const out = renderMarkdown('<img src=x onerror="alert(1)">');
		expect(out).not.toContain('<img');
		expect(out).toContain('&lt;img');
		expect(out).toContain('&quot;');
	});

	test('escapes ampersands, quotes, and apostrophes', () => {
		const out = renderMarkdown(`a & b "c" 'd'`);
		expect(out).toContain('a &amp; b &quot;c&quot; &#39;d&#39;');
	});

	test('rejects javascript: URLs in links', () => {
		const out = renderMarkdown('[click](javascript:alert(1))');
		expect(out).not.toContain('<a');
		expect(out).not.toContain('href');
	});

	test('rejects data: and other non-http schemes', () => {
		expect(renderMarkdown('[x](data:text/html,<script>)')).not.toContain('<a');
		expect(renderMarkdown('[x](ftp://example.com)')).not.toContain('<a');
	});

	test('link URLs cannot break out of the href attribute', () => {
		// Quotes are escaped before the link regex runs, so injection is impossible.
		const out = renderMarkdown('[x](https://example.com/"onclick="alert(1))');
		expect(out).not.toContain('onclick="alert');
	});

	test('nested odd formatting cannot inject markup', () => {
		const out = renderMarkdown('**<b onclick="x()">hi</b>**');
		expect(out).not.toContain('<b onclick');
		expect(out).toContain('<strong>&lt;b onclick=&quot;x()&quot;&gt;hi&lt;/b&gt;</strong>');
	});

	test('strips NUL bytes so internal placeholders cannot be forged', () => {
		const out = renderMarkdown('\x00B0\x00 \x00I0\x00');
		expect(out).not.toContain('<pre');
		expect(out).not.toContain('<code');
	});
});

describe('existing behavior preserved', () => {
	test('empty input returns empty string', () => {
		expect(renderMarkdown('')).toBe('');
	});

	test('renders all heading levels', () => {
		expect(renderMarkdown('# h1')).toBe('<h1>h1</h1>');
		expect(renderMarkdown('### h3')).toBe('<h3>h3</h3>');
		expect(renderMarkdown('###### h6')).toBe('<h6>h6</h6>');
	});

	test('renders bold, italic, and bold-italic with asterisks', () => {
		expect(renderMarkdown('**b**')).toContain('<strong>b</strong>');
		expect(renderMarkdown('*i*')).toContain('<em>i</em>');
		expect(renderMarkdown('***bi***')).toContain('<strong><em>bi</em></strong>');
	});

	test('renders bold, italic, and bold-italic with underscores', () => {
		expect(renderMarkdown('__b__')).toContain('<strong>b</strong>');
		expect(renderMarkdown('_i_')).toContain('<em>i</em>');
		expect(renderMarkdown('___bi___')).toContain('<strong><em>bi</em></strong>');
	});

	test('renders http(s) links with safe attributes', () => {
		const out = renderMarkdown('[site](https://example.com)');
		expect(out).toContain(
			'<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="link">site</a>'
		);
	});

	test('renders unordered lists', () => {
		const out = renderMarkdown('- one\n- two');
		expect(out).toContain('<ul class="list-disc pl-5 space-y-1"><li>one</li><li>two</li></ul>');
	});

	test('renders ordered lists', () => {
		const out = renderMarkdown('1. one\n2. two');
		expect(out).toContain('<ol class="list-decimal pl-5 space-y-1"><li>one</li><li>two</li></ol>');
	});

	test('wraps plain text in paragraphs and converts single newlines to <br>', () => {
		const out = renderMarkdown('line one\nline two');
		expect(out).toBe('<p class="leading-relaxed">line one<br />line two</p>');
	});

	test('splits blank-line-separated blocks into paragraphs', () => {
		const out = renderMarkdown('first\n\nsecond');
		expect(out).toBe('<p class="leading-relaxed">first</p>\n<p class="leading-relaxed">second</p>');
	});
});

describe('code and strikethrough', () => {
	test('renders inline code without formatting its contents', () => {
		const out = renderMarkdown('run `**not bold**` now');
		expect(out).toContain('<code class="rounded bg-muted/40 px-1 py-0.5">**not bold**</code>');
		expect(out).not.toContain('<strong>not bold</strong>');
	});

	test('renders fenced code blocks without formatting their contents', () => {
		const out = renderMarkdown('```\n# not a heading\n- not a list\n```');
		expect(out).toContain('<pre');
		expect(out).toContain('# not a heading\n- not a list');
		expect(out).not.toContain('<h1>');
		expect(out).not.toContain('<ul');
	});

	test('fenced code blocks keep escaped HTML literal', () => {
		const out = renderMarkdown('```\n<script>alert(1)</script>\n```');
		expect(out).toContain('&lt;script&gt;');
		expect(out).not.toContain('<script>');
	});

	test('inline code keeps escaped HTML literal', () => {
		const out = renderMarkdown('`<img src=x onerror=alert(1)>`');
		expect(out).not.toContain('<img');
		expect(out).toContain('&lt;img');
	});

	test('renders strikethrough', () => {
		expect(renderMarkdown('~~gone~~')).toContain('<del>gone</del>');
	});
});

describe('underscore emphasis boundaries', () => {
	test('does not italicize intraword underscores', () => {
		expect(renderMarkdown('snake_case_name')).not.toContain('<em>');
		expect(renderMarkdown('user__id__field')).not.toContain('<strong>');
	});

	test('still emphasizes at word boundaries', () => {
		expect(renderMarkdown('a _b_ c')).toContain('<em>b</em>');
		expect(renderMarkdown('a __b__ c')).toContain('<strong>b</strong>');
	});
});
