import { DateTime } from 'luxon';

export type FieldErrors = Record<string, string>;

export class Validator {
	errors: FieldErrors = {};

	ok(): boolean {
		return Object.keys(this.errors).length === 0;
	}

	failMessage(): string {
		return 'Please fix the highlighted fields.';
	}

	requiredString(raw: unknown, field: string, opts?: { max?: number }): string | undefined {
		const v = typeof raw === 'string' ? raw.trim() : '';
		if (!v) {
			this.errors[field] = `${field} is required`;
		} else if (opts?.max != null && v.length > opts.max) {
			this.errors[field] = `${field} must be at most ${opts.max} characters`;
		}
		return v || undefined;
	}

	optionalString(raw: unknown, field: string, opts?: { max?: number }): string | undefined {
		if (raw == null || raw === '') return undefined;
		if (typeof raw !== 'string') {
			this.errors[field] = `${field} must be a string`;
			return undefined;
		}
		const v = raw.trim();
		if (opts?.max != null && v.length > opts.max) {
			this.errors[field] = `${field} must be at most ${opts.max} characters`;
		}
		return v || undefined;
	}

	enumValue<T extends string>(raw: unknown, allowed: readonly T[], field: string): T | undefined {
		const v = typeof raw === 'string' ? raw : '';
		if (!allowed.includes(v as T)) {
			this.errors[field] = `${field} must be one of: ${allowed.join(', ')}`;
			return undefined;
		}
		return v as T;
	}

	timezone(raw: unknown, field: string): string | undefined {
		const v = typeof raw === 'string' ? raw.trim() : '';
		if (!v) {
			this.errors[field] = `${field} is required`;
			return undefined;
		}
		if (!DateTime.now().setZone(v).isValid) {
			this.errors[field] = `${field} must be a valid IANA timezone`;
			return undefined;
		}
		return v;
	}

	date(raw: unknown, field: string): string | undefined {
		const v = typeof raw === 'string' ? raw.trim() : '';
		if (!v) return undefined;
		const dt = DateTime.fromISO(v, { zone: 'utc' });
		if (!dt.isValid || dt.toFormat('yyyy-MM-dd') !== v) {
			this.errors[field] = `${field} must be a valid date (YYYY-MM-DD)`;
			return undefined;
		}
		return v;
	}

	requiredDate(raw: unknown, field: string): string | undefined {
		const v = this.date(raw, field);
		if (v == null && !this.errors[field]) {
			this.errors[field] = `${field} is required`;
		}
		return v;
	}

	dateTime(raw: unknown, field: string): string | undefined {
		const v = typeof raw === 'string' ? raw.trim() : '';
		if (!v) return undefined;
		const dt = DateTime.fromISO(v);
		if (!dt.isValid) {
			this.errors[field] = `${field} must be a valid datetime`;
			return undefined;
		}
		return v;
	}

	requiredDateTime(raw: unknown, field: string): string | undefined {
		const v = this.dateTime(raw, field);
		if (v == null && !this.errors[field]) {
			this.errors[field] = `${field} is required`;
		}
		return v;
	}

	positiveId(raw: unknown, field: string): number | undefined {
		if (raw == null || raw === '') {
			this.errors[field] = `${field} is required`;
			return undefined;
		}
		const n = Number(raw);
		if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
			this.errors[field] = `${field} must be a positive integer`;
			return undefined;
		}
		return n;
	}

	dateRange(
		start: string | undefined,
		end: string | undefined,
		startField = 'startDate',
		endField = 'endDate'
	): void {
		if (start == null || end == null) return;
		if (start > end) {
			this.errors[startField] = `${startField} must be on or before ${endField}`;
		}
	}
}
