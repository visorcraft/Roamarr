import { DateTime } from 'luxon';

export const USPS_HOLD_MAX_DAYS = 30;
export const DEFAULT_MAIL_HOLD_LEAD_DAYS = 3;

const COVERING_STATUSES = new Set(['requested', 'active', 'ended']);

export interface MailHoldSpan {
	id: number;
	carrier: string;
	startDate: string;
	endDate: string;
	status: string;
	addressLabel?: string | null;
}

export interface MailHoldDateRange {
	start: string;
	end: string;
}

export interface MailHoldCoverage {
	awayStart: string | null;
	awayEnd: string | null;
	awayDatesKnown: boolean;
	uncoveredDays: string[];
	uncoveredRanges: MailHoldDateRange[];
	renewals: { id: number; renewalDate: string }[];
	warnings: { id: number; message: string }[];
	suggestedNext: {
		startDate: string;
		endDate: string;
		carrier: string;
		addressLabel: string | null;
	} | null;
}

export function inclusiveDayCount(start: string, end: string): number {
	const startDt = DateTime.fromISO(start, { zone: 'utc' });
	const endDt = DateTime.fromISO(end, { zone: 'utc' });
	if (!startDt.isValid || !endDt.isValid) return 0;
	return Math.round(endDt.diff(startDt, 'days').days) + 1;
}

export function uspsHoldWarning(carrier: string, start: string, end: string): string | null {
	if (carrier.trim().toLowerCase() !== 'usps') return null;
	if (inclusiveDayCount(start, end) <= USPS_HOLD_MAX_DAYS) return null;
	return 'USPS caps a single hold at 30 days. This hold is longer, so you may need to split or renew it.';
}

export function nextMailHoldWindow(endDate: string): { startDate: string; endDate: string } {
	const start = DateTime.fromISO(endDate, { zone: 'utc' }).plus({ days: 1 });
	const end = start.plus({ days: USPS_HOLD_MAX_DAYS - 1 });
	return { startDate: start.toISODate()!, endDate: end.toISODate()! };
}

function eachDate(start: string, end: string): string[] {
	const days: string[] = [];
	let cursor = DateTime.fromISO(start, { zone: 'utc' });
	const last = DateTime.fromISO(end, { zone: 'utc' });
	if (!cursor.isValid || !last.isValid || cursor > last) return days;
	while (cursor <= last) {
		days.push(cursor.toISODate()!);
		cursor = cursor.plus({ days: 1 });
	}
	return days;
}

function collapseDays(days: string[]): MailHoldDateRange[] {
	const ranges: MailHoldDateRange[] = [];
	for (const day of days) {
		const previous = ranges.at(-1);
		if (!previous) {
			ranges.push({ start: day, end: day });
			continue;
		}
		const next = DateTime.fromISO(previous.end, { zone: 'utc' }).plus({ days: 1 }).toISODate();
		if (next === day) previous.end = day;
		else ranges.push({ start: day, end: day });
	}
	return ranges;
}

export function emptyMailHoldCoverage(): MailHoldCoverage {
	return {
		awayStart: null,
		awayEnd: null,
		awayDatesKnown: false,
		uncoveredDays: [],
		uncoveredRanges: [],
		renewals: [],
		warnings: [],
		suggestedNext: null
	};
}

export function coverMailHolds(
	awayStart: string | null | undefined,
	awayEnd: string | null | undefined,
	holds: MailHoldSpan[]
): MailHoldCoverage {
	const warnings = holds.flatMap((hold) => {
		const message = uspsHoldWarning(hold.carrier, hold.startDate, hold.endDate);
		return message ? [{ id: hold.id, message }] : [];
	});
	const covering = holds.filter((hold) => COVERING_STATUSES.has(hold.status));
	const renewals = covering.map((hold) => ({ id: hold.id, renewalDate: hold.endDate }));
	if (!awayStart || !awayEnd) {
		return { ...emptyMailHoldCoverage(), awayStart: awayStart ?? null, awayEnd: awayEnd ?? null, renewals, warnings };
	}

	const covered = new Set<string>();
	for (const hold of covering) {
		for (const day of eachDate(hold.startDate, hold.endDate)) covered.add(day);
	}
	const uncoveredDays = eachDate(awayStart, awayEnd).filter((day) => !covered.has(day));
	const latest = covering.reduce<MailHoldSpan | null>((best, hold) => {
		if (!best || hold.endDate > best.endDate) return hold;
		return best;
	}, null);
	const suggestedNext =
		latest == null
			? { ...nextMailHoldWindow(DateTime.fromISO(awayStart, { zone: 'utc' }).minus({ days: 1 }).toISODate()!), carrier: 'USPS', addressLabel: null }
			: latest.endDate >= awayEnd
				? null
				: { ...nextMailHoldWindow(latest.endDate), carrier: latest.carrier, addressLabel: latest.addressLabel ?? null };

	return {
		awayStart,
		awayEnd,
		awayDatesKnown: true,
		uncoveredDays,
		uncoveredRanges: collapseDays(uncoveredDays),
		renewals,
		warnings,
		suggestedNext
	};
}
