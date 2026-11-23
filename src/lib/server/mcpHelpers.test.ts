import { describe, test, expect } from 'vitest';
import { paginateList, encodeCursor, decodeCursor } from './mcpHelpers';

describe('paginateList', () => {
	test('walks every row exactly once, in order, across sizes and page sizes 1-8', () => {
		for (let size = 1; size <= 8; size++) {
			for (let limit = 1; limit <= 8; limit++) {
				const rows = Array.from({ length: size }, (_, i) => i + 1);
				const seen: number[] = [];
				let cursor: string | null = null;
				let pages = 0;
				for (;;) {
					const { items, nextCursor }: { items: number[]; nextCursor: string | null } = paginateList(
						rows,
						{ limit, ...(cursor != null ? { cursor } : {}) },
						(n) => n
					);
					expect(items.length).toBeGreaterThan(0);
					expect(items.length).toBeLessThanOrEqual(limit);
					seen.push(...items);
					pages += 1;
					expect(pages).toBeLessThanOrEqual(size);
					if (nextCursor == null) break;
					cursor = nextCursor;
				}
				expect(seen).toEqual(rows);
			}
		}
	});

	test('exact multiple of the page size gives two pages and then a null cursor', () => {
		const rows = [1, 2, 3, 4];
		const first = paginateList(rows, { limit: 2 }, (n) => n);
		expect(first.items).toEqual([1, 2]);
		expect(first.nextCursor).not.toBeNull();
		const second = paginateList(rows, { limit: 2, cursor: first.nextCursor as string }, (n) => n);
		expect(second.items).toEqual([3, 4]);
		expect(second.nextCursor).toBeNull();
	});

	test('cursor encodes the key of the last row on the page', () => {
		const rows = [10, 11, 12];
		const first = paginateList(rows, { limit: 2 }, (n) => n);
		expect(first.items).toEqual([10, 11]);
		expect(first.nextCursor).not.toBeNull();
		expect(decodeCursor(first.nextCursor)).toBe('11');
	});

	test('unknown cursor starts from the top of the list', () => {
		const rows = [1, 2, 3, 4];
		const unknown = encodeCursor('does-not-exist');
		const { items, nextCursor } = paginateList(rows, { limit: 2, cursor: unknown }, (n) => n);
		expect(items).toEqual([1, 2]);
		expect(nextCursor).not.toBeNull();
	});

	test('empty list yields an empty page and a null cursor', () => {
		const { items, nextCursor } = paginateList([], { limit: 2 }, (n: number) => n);
		expect(items).toEqual([]);
		expect(nextCursor).toBeNull();
	});
});
