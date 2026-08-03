export function renderMarkdown(md: string): string {
	if (!md) return '';
	// Escape HTML first to avoid XSS. Everything below operates on escaped
	// text, so captured groups can never inject markup. NUL bytes are
	// stripped because they are used as internal placeholder sentinels.
	let html = md
		.replace(/\x00/g, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

	// Fenced code blocks and inline code are extracted before other inline
	// formatting so their contents stay literal; restored at the end.
	const codeBlocks: string[] = [];
	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang: string, code: string) => {
		codeBlocks.push(code.replace(/\n$/, ''));
		return `\x00B${codeBlocks.length - 1}\x00`;
	});
	const inlineCodes: string[] = [];
	html = html.replace(/`([^`\n]+)`/g, (_match, code: string) => {
		inlineCodes.push(code);
		return `\x00I${inlineCodes.length - 1}\x00`;
	});

	// Headings
	html = html.replace(/^######\s+(.*)$/gim, '<h6>$1</h6>');
	html = html.replace(/^#####\s+(.*)$/gim, '<h5>$1</h5>');
	html = html.replace(/^####\s+(.*)$/gim, '<h4>$1</h4>');
	html = html.replace(/^###\s+(.*)$/gim, '<h3>$1</h3>');
	html = html.replace(/^##\s+(.*)$/gim, '<h2>$1</h2>');
	html = html.replace(/^#\s+(.*)$/gim, '<h1>$1</h1>');

	// Bold / italic. Underscore variants require non-word boundaries so
	// snake_case_identifiers stay literal (CommonMark intraword rule).
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
	html = html.replace(/(?<![A-Za-z0-9_])___(.+?)___(?![A-Za-z0-9_])/g, '<strong><em>$1</em></strong>');
	html = html.replace(/(?<![A-Za-z0-9_])__(.+?)__(?![A-Za-z0-9_])/g, '<strong>$1</strong>');
	html = html.replace(/(?<![A-Za-z0-9_])_(.+?)_(?![A-Za-z0-9_])/g, '<em>$1</em>');

	// Strikethrough
	html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

	// Links [text](url) — http(s) only, so javascript: etc. can never land in href.
	html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="link">$1</a>');

	// Unordered lists
	html = html.replace(/(^|\n)([-*]\s+.*(?:\n|$))+/g, (match) => {
		const items = match
			.trim()
			.split('\n')
			.map((line) => `<li>${line.replace(/^[-*]\s+/, '')}</li>`)
			.join('');
		return `<ul class="list-disc pl-5 space-y-1">${items}</ul>`;
	});

	// Ordered lists
	html = html.replace(/(^|\n)(\d+\.\s+.*(?:\n|$))+/g, (match) => {
		const items = match
			.trim()
			.split('\n')
			.map((line) => `<li>${line.replace(/^\d+\.\s+/, '')}</li>`)
			.join('');
		return `<ol class="list-decimal pl-5 space-y-1">${items}</ol>`;
	});

	// Paragraphs
	html = html
		.split(/\n{2,}/)
		.map((block) => {
			const trimmed = block.trim();
			if (!trimmed) return '';
			if (/^(?:<(?:h|ul|ol|li|p|blockquote)|\x00B)/.test(trimmed)) return trimmed;
			return `<p class="leading-relaxed">${trimmed.replace(/\n/g, '<br />')}</p>`;
		})
		.join('\n');

	// Restore extracted code. Contents were escaped up front, never re-processed.
	html = html.replace(
		/\x00B(\d+)\x00/g,
		(_match, i: string) =>
			`<pre class="overflow-x-auto rounded-md bg-muted/40 p-3 text-sm"><code>${codeBlocks[Number(i)] ?? ''}</code></pre>`
	);
	html = html.replace(
		/\x00I(\d+)\x00/g,
		(_match, i: string) => `<code class="rounded bg-muted/40 px-1 py-0.5">${inlineCodes[Number(i)] ?? ''}</code>`
	);

	return html;
}
