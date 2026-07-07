export interface TableParams {
	page: number;
	limit: number;
	search: string;
	sort: string | null;
	dir: 'asc' | 'desc';
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

function parsePositiveInt(raw: string | null, fallback: number): number {
	const value = Number(raw);
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
		return fallback;
	}
	return value;
}

export function parseTableParams(url: URL, allowedSorts?: string[]): TableParams {
	const pageRaw = url.searchParams.get('page');
	const limitRaw = url.searchParams.get('limit');
	let sort: string | null = (url.searchParams.get('sort') ?? '').trim();
	if (sort === '') sort = null;
	if (allowedSorts && sort !== null && !allowedSorts.includes(sort)) {
		sort = null;
	}
	return {
		page: parsePositiveInt(pageRaw, 1),
		limit: Math.min(parsePositiveInt(limitRaw, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE),
		search: (url.searchParams.get('search') ?? '').trim().toLowerCase().slice(0, 200),
		sort,
		dir: (url.searchParams.get('dir') ?? 'asc') === 'desc' ? 'desc' : 'asc'
	};
}

export function buildTableQuery(params: Partial<TableParams>): string {
	const p = new URLSearchParams();
	if (params.page && params.page > 1) p.set('page', String(params.page));
	if (params.limit && params.limit !== DEFAULT_PAGE_SIZE) p.set('limit', String(params.limit));
	if (params.search) p.set('search', params.search);
	if (params.sort) {
		p.set('sort', params.sort);
		p.set('dir', params.dir ?? 'asc');
	}
	return p.toString();
}
