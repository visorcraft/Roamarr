import { kit, getDb } from '../db';
import { eq, type ColumnSpec, type Insert, type ConstraintKit } from '@visorcraft/mongreldb-kit';

export function getConstraintKit(): ConstraintKit {
	const db = getDb();
	return { db: db.nativeDb, schema: db.schema };
}

export function toBigInt(id: number): bigint {
	return BigInt(id);
}

export function idFromBigInt(id: bigint | number): number {
	return Number(id);
}

export function optionalBigInt(value: number | null | undefined): bigint | null {
	return value == null ? null : BigInt(value);
}

export function optionalNumber(value: bigint | null | undefined): number | null {
	return value == null ? null : Number(value);
}

export function optionalFkNumber(value: bigint | null | undefined): number | null {
	return value == null || value === 0n ? null : Number(value);
}

export function nullableText(value: string | null | undefined): string | null {
	return value == null || value === '' ? null : value;
}

export function kitReinsertWithId(
	table: { id: ColumnSpec; columns: readonly ColumnSpec[] },
	existing: Record<string, unknown>,
	patch: Record<string, unknown>
): Record<string, unknown> {
	const updated = { ...existing, ...patch };
	kit.deleteFrom(table as never).where(eq(table.id, existing.id as bigint)).executeSync();
	return kit.insertInto(table as never).values(updated as Insert<never>).executeSync();
}
