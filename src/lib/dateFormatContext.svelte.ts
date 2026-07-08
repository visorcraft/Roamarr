import { getContext, setContext } from 'svelte';
import {
	formatDate as formatDateBase,
	formatDateTime as formatDateTimeBase,
	formatTime as formatTimeBase,
	DEFAULT_DATE_FORMAT,
	DEFAULT_DATETIME_FORMAT
} from './dateFormat';

export interface DateFormatContext {
	readonly dateFormat: string;
	readonly datetimeFormat: string;
}

const KEY = Symbol('dateFormat');

export function provideDateFormat(ctx: DateFormatContext) {
	setContext(KEY, ctx);
}

function resolveCtx(): DateFormatContext {
	return getContext<DateFormatContext | undefined>(KEY) ?? {
		dateFormat: DEFAULT_DATE_FORMAT,
		datetimeFormat: DEFAULT_DATETIME_FORMAT
	};
}

/** Returns format helpers bound to the current Svelte context's user formats. */
export function useDateFormat() {
	const ctx = resolveCtx();
	return {
		get dateFormat() {
			return ctx.dateFormat;
		},
		get datetimeFormat() {
			return ctx.datetimeFormat;
		},
		formatDate: (
			iso: string | null | undefined,
			opts?: { format?: string; dateStyle?: 'short' | 'medium' | 'long' }
		) =>
			formatDateBase(iso, {
				format: opts?.format ?? (opts?.dateStyle ? undefined : ctx.dateFormat),
				dateStyle: opts?.dateStyle
			}),
		formatDateTime: (
			iso: string | null | undefined,
			opts?: {
				format?: string;
				dateStyle?: 'short' | 'medium' | 'long';
				timeStyle?: 'short' | 'medium';
				timeZone?: string;
			}
		) =>
			formatDateTimeBase(iso, {
				format: opts?.format ?? ((opts?.dateStyle || opts?.timeStyle) ? undefined : ctx.datetimeFormat),
				dateStyle: opts?.dateStyle,
				timeStyle: opts?.timeStyle,
				timeZone: opts?.timeZone
			}),
		formatTime: (iso: string | null | undefined, timeZone = 'UTC') => formatTimeBase(iso, timeZone)
	};
}
