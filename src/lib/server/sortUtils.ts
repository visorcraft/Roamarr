export function compareRows<T extends object>(
	a: T,
	b: T,
	key: keyof T,
	dir: 'asc' | 'desc'
): number {
	let av: unknown = a[key];
	let bv: unknown = b[key];
	if (typeof av === 'bigint') av = Number(av);
	if (typeof bv === 'bigint') bv = Number(bv);
	if (typeof av === 'boolean' && typeof bv === 'boolean') {
		if (av === bv) return 0;
		return dir === 'asc' ? (av ? 1 : -1) : av ? -1 : 1;
	}
	if (av == null) av = '';
	if (bv == null) bv = '';
	if (typeof av === 'string' && typeof bv === 'string') {
		const as = av.toLowerCase();
		const bs = bv.toLowerCase();
		if (as < bs) return dir === 'asc' ? -1 : 1;
		if (as > bs) return dir === 'asc' ? 1 : -1;
		return 0;
	}
	if ((av as string | number) < (bv as string | number)) return dir === 'asc' ? -1 : 1;
	if ((av as string | number) > (bv as string | number)) return dir === 'asc' ? 1 : -1;
	return 0;
}
