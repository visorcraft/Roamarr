export function renderMarkdown(md: string): string {
	if (!md) return '';
	// Escape HTML first to avoid XSS.
	let html = md
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

	// Headings
	html = html.replace(/^######\s+(.*)$/gim, '<h6>$1</h6>');
	html = html.replace(/^#####\s+(.*)$/gim, '<h5>$1</h5>');
	html = html.replace(/^####\s+(.*)$/gim, '<h4>$1</h4>');
	html = html.replace(/^###\s+(.*)$/gim, '<h3>$1</h3>');
	html = html.replace(/^##\s+(.*)$/gim, '<h2>$1</h2>');
	html = html.replace(/^#\s+(.*)$/gim, '<h1>$1</h1>');

	// Bold / italic
	html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
	html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
	html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
	html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
	html = html.replace(/_(.+?)_/g, '<em>$1</em>');

	// Links [text](url)
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
			if (/^<(?:h|ul|ol|li|p|blockquote)/.test(trimmed)) return trimmed;
			return `<p class="leading-relaxed">${trimmed.replace(/\n/g, '<br />')}</p>`;
		})
		.join('\n');

	return html;
}
