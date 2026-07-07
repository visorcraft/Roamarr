import { describe, it, expect } from 'vitest';
import { parseTableParams, buildTableQuery, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './tableParams';

function url(q: string) {
	return new URL('http://localhost/test?' + q);
}

describe('parseTableParams', () => {
	it('returns defaults for an empty query', () => {
		const p = parseTableParams(url(''));
		expect(p.page).toBe(1);
		expect(p.limit).toBe(DEFAULT_PAGE_SIZE);
		expect(p.search).toBe('');
		expect(p.sort).toBeNull();
		expect(p.dir).toBe('asc');
	});

	it('parses all params', () => {
		const p = parseTableParams(url('page=3&limit=10&search=foo&sort=email&dir=desc'));
		expect(p.page).toBe(3);
		expect(p.limit).toBe(10);
		expect(p.search).toBe('foo');
		expect(p.sort).toBe('email');
		expect(p.dir).toBe('desc');
	});

	it('normalizes search to lowercase and trims', () => {
		const p = parseTableParams(url('search=  Foo BAR  '));
		expect(p.search).toBe('foo bar');
	});

	it('rejects invalid page and limit', () => {
		const p = parseTableParams(url('page=0&limit=-1'));
		expect(p.page).toBe(1);
		expect(p.limit).toBe(DEFAULT_PAGE_SIZE);
	});

	it('rejects non-numeric page', () => {
		const p = parseTableParams(url('page=abc'));
		expect(p.page).toBe(1);
	});

	it('rejects non-integer limit', () => {
		const p = parseTableParams(url('limit=10.5'));
		expect(p.limit).toBe(DEFAULT_PAGE_SIZE);
	});

	it('caps oversized limit to MAX_PAGE_SIZE', () => {
		const p = parseTableParams(url('limit=999999999'));
		expect(p.limit).toBe(MAX_PAGE_SIZE);
	});

	it('falls back to asc for invalid dir', () => {
		const p = parseTableParams(url('dir=invalid'));
		expect(p.dir).toBe('asc');
	});

	it('trims sort with whitespace', () => {
		const p = parseTableParams(url('sort=  email  '));
		expect(p.sort).toBe('email');
	});

	it('rejects unknown sort keys when allowedSorts is provided', () => {
		const p = parseTableParams(url('sort=email'), ['name', 'createdAt']);
		expect(p.sort).toBeNull();
	});

	it('keeps known sort keys when allowedSorts is provided', () => {
		const p = parseTableParams(url('sort=createdAt'), ['name', 'createdAt']);
		expect(p.sort).toBe('createdAt');
	});

	it('caps search strings at 200 characters', () => {
		const long = 'a'.repeat(300);
		const p = parseTableParams(url('search=' + long));
		expect(p.search).toBe('a'.repeat(200));
	});
});

describe('buildTableQuery', () => {
	it('omits defaults', () => {
		expect(buildTableQuery({ page: 1, limit: DEFAULT_PAGE_SIZE })).toBe('');
	});

	it('builds a full query', () => {
		expect(buildTableQuery({ page: 2, search: 'foo', sort: 'email', dir: 'desc' })).toBe(
			'page=2&search=foo&sort=email&dir=desc'
		);
	});

	it('builds with custom limit and dir asc', () => {
		expect(buildTableQuery({ page: 1, limit: 50, sort: 'name', dir: 'asc' })).toBe(
			'limit=50&sort=name&dir=asc'
		);
	});
});
