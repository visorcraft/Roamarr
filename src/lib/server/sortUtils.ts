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
	if (av == null) av = '';
	if (bv == null) bv = '';
	if ((av as string | number) < (bv as string | number)) return dir === 'asc' ? -1 : 1;
	if ((av as string | number) > (bv as string | number)) return dir === 'asc' ? 1 : -1;
	return 0;
}
