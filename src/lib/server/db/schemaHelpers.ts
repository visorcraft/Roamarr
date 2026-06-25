import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/sqlite-core';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

export function enumCheck<const T extends readonly string[]>(
	column: SQLiteColumn,
	values: T,
	opts: { nullable?: boolean; constraintName?: string } = {}
): ReturnType<typeof check> {
	const valuesSql = sql.join(values.map((v) => sql.raw(`'${v}'`)), sql.raw(', '));
	const inValues = sql`${column} in (${valuesSql})`;
	const checkExpr = opts.nullable ? sql`${column} is null or ${inValues}` : inValues;
	return check(opts.constraintName ?? `${column.name}_ck`, checkExpr);
}
