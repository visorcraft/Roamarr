import { DateTime } from 'luxon';

export interface DateRange {
	startDate: string;
	endDate: string;
}

export interface NamedTrip {
	name: string;
	startDate: string;
	endDate: string;
}

export interface PaymentDueTrip extends DateRange {
	paymentDueDate: string;
}

/**
 * Builds anchor-relative ISO dates/timestamps for seed/demo data.
 *
 * Accepts an optional `now` anchor (a Luxon DateTime or JS Date) so tests and
 * seeders can produce stable output. All calculations are performed in UTC.
 */
export class SeedDateBuilder {
	#anchor: DateTime;

	/** The anchored UTC "today" used for all deterministic date calculations. */
	get now(): DateTime {
		return this.#anchor;
	}

	constructor(now?: DateTime | Date) {
		if (!now) {
			this.#anchor = DateTime.now().toUTC().startOf('day');
		} else if (now instanceof DateTime) {
			this.#anchor = now.toUTC().startOf('day');
		} else {
			this.#anchor = DateTime.fromJSDate(now).toUTC().startOf('day');
		}
	}

	/** A one-week trip starting at the beginning of the month three months ago, clamped to the current year. */
	pastTripEarlierThisYear(): DateRange {
		let start = this.now.minus({ months: 3 }).startOf('month');
		if (start.year < this.now.year) {
			start = DateTime.utc(this.now.year, 1, 1);
		}
		return {
			startDate: this.toIsoDate(start),
			endDate: this.toIsoDate(start.plus({ days: 7 }))
		};
	}

	/** A ten-day trip starting in the month two months before the same month last year. */
	pastTripLastYear(): DateRange {
		const start = this.now.minus({ years: 1, months: 2 }).startOf('month');
		return {
			startDate: this.toIsoDate(start),
			endDate: this.toIsoDate(start.plus({ days: 10 }))
		};
	}

	/** Three trips spread across the next calendar year. */
	futureTrips(): NamedTrip[] {
		const year = this.now.year + 1;
		return [
			{
				name: 'Spring break',
				startDate: DateTime.utc(year, 3, 15).toISODate()!,
				endDate: DateTime.utc(year, 3, 22).toISODate()!
			},
			{
				name: 'Summer road trip',
				startDate: DateTime.utc(year, 7, 10).toISODate()!,
				endDate: DateTime.utc(year, 7, 24).toISODate()!
			},
			{
				name: 'Holiday markets',
				startDate: DateTime.utc(year, 12, 15).toISODate()!,
				endDate: DateTime.utc(year, 12, 22).toISODate()!
			}
		];
	}

	/**
	 * A trip whose payment is due 14 days from the anchor and whose dates are
	 * two months from the anchor.
	 */
	paymentDueSoon(): PaymentDueTrip {
		const paymentDueDate = this.now.plus({ days: 14 });
		const startDate = this.now.plus({ months: 2 });
		return {
			paymentDueDate: this.toIsoDate(paymentDueDate),
			startDate: this.toIsoDate(startDate),
			endDate: this.toIsoDate(startDate.plus({ days: 5 }))
		};
	}

	/** August 15 of the current year if still before August, otherwise next year. */
	augustExpiry(): string {
		const year = this.now.month < 8 ? this.now.year : this.now.year + 1;
		return this.toIsoDate(DateTime.utc(year, 8, 15));
	}

	/** 60 days from the anchor. */
	sixtyDayExpiry(): string {
		return this.toIsoDate(this.now.plus({ days: 60 }));
	}

	/**
	 * ISO timestamp roughly one hour from the current real time. This deliberately
	 * uses wall-clock time instead of the anchor so that seeded reminders always
	 * fire in the future, regardless of when the seeder is run.
	 */
	slightlyFuture(): string {
		return DateTime.utc().plus({ hours: 1 }).toISO()!;
	}

	private toIsoDate(dt: DateTime): string {
		return dt.toISODate()!;
	}
}
