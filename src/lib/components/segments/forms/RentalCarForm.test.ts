import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { m } from '$lib/paraglide/messages';
import RentalCarForm from './RentalCarForm.svelte';

// Safety net for form-field consolidation (default-visible fields only; closed
// CollapseSections and the sameAsPickup=false branch are not SSR by default).
describe('RentalCarForm', () => {
	const CATALOG_ENTRIES: [string, string][] = [
		['rental_car_agency_label', 'Rental agency'],
		['rental_car_agency_placeholder', 'Enter rental agency'],
		['rental_car_pickup_date_label', 'Pick-up date'],
		['rental_car_pickup_time_label', 'Pick-up time'],
		['rental_car_pickup_timezone_label', 'Timezone'],
		['rental_car_dropoff_date_label', 'Drop-off date'],
		['rental_car_dropoff_time_label', 'Drop-off time'],
		['rental_car_dropoff_timezone_label', 'Drop-off timezone'],
		['rental_car_website_label', 'Website'],
		['rental_car_website_placeholder', 'Enter website'],
		['rental_car_email_label', 'Email'],
		['rental_car_email_placeholder', 'Enter email'],
		['rental_car_confirmation_label', 'Confirmation'],
		['rental_car_confirmation_placeholder', 'Enter confirmation'],
		['rental_car_total_cost_label', 'Total cost'],
		['rental_car_total_cost_placeholder', 'Enter total cost'],
		['rental_car_pickup_section', 'Pickup'],
		['rental_car_pickup_location_label', 'Pickup location'],
		['rental_car_pickup_location_placeholder', 'Enter pickup location'],
		['rental_car_address_label', 'Address'],
		['rental_car_address_placeholder', 'Enter address'],
		['rental_car_phone_label', 'Phone'],
		['rental_car_phone_placeholder', 'Enter phone'],
		['rental_car_dropoff_section', 'Drop-off'],
		['rental_car_same_as_pickup_label', 'Same as pickup location'],
		['rental_car_dropoff_location_label', 'Drop-off location'],
		['rental_car_dropoff_location_placeholder', 'Enter drop-off location'],
		['rental_car_info_section', 'Rental info'],
		['rental_car_car_type_label', 'Car type'],
		['rental_car_car_type_placeholder', 'Enter car type'],
		['rental_car_mileage_charges_label', 'Mileage charges'],
		['rental_car_mileage_charges_placeholder', 'Enter mileage charges'],
		['rental_car_car_details_label', 'Car details'],
		['rental_car_car_details_placeholder', 'Enter car details'],
		['rental_car_meeting_point_label', 'Meeting / rally point'],
		['rental_car_meeting_point_placeholder', 'e.g. Rental counter, hotel lobby'],
		['rental_car_rally_time_label', 'Rally time'],
		['rental_car_notes_label', 'Notes'],
		['rental_car_notes_placeholder', "Enter note e.g. Don't forget your charger!"],
		['rental_car_more_details_section', 'More details'],
		['rental_car_expand_all', 'Expand all'],
		['rental_car_drivers_section', 'Drivers'],
		['rental_car_drivers_placeholder', 'Driver names']
	];

	it('renders expected default-visible fields', () => {
		const { body } = render(RentalCarForm, { props: {} });
		const fields = [
			'title', 'startDate', 'startTime', 'startTz', 'endDate', 'endTime', 'endTz',
			'detail_website', 'detail_email', 'confirmationNumber', 'detail_totalCost', 'detail_booked',
			'detail_pickupLocation', 'location', 'detail_phone', 'detail_sameAsPickup',
			'detail_carType', 'detail_mileageCharges', 'detail_carDetails',
			'meetingPoint', 'meetingAt', 'detail_notes'
		];
		for (const f of fields) {
			expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
		}
	});

	it('surfaces errors', () => {
		const { body } = render(RentalCarForm, {
			props: { errors: { title: 'Agency?', location: 'Address?', meetingPoint: 'Where?' } }
		});
		expect(body).toContain('Agency?');
		expect(body).toContain('Address?');
		expect(body).toContain('Where?');
	});

	it.each(CATALOG_ENTRIES)('%s returns the exact English string', (key, text) => {
		const fn = (m as Record<string, unknown>)[key] as () => string;
		expect(fn()).toBe(text);
	});

	it('references the catalog and keeps hardcoded UI strings out of the source', () => {
		const source = readFileSync(
			path.join(path.dirname(fileURLToPath(import.meta.url)), 'RentalCarForm.svelte'),
			'utf8'
		);
		expect(source).toContain("from '$lib/paraglide/messages'");

		const stringAttrs = source.match(/(?:label|placeholder|title)="([^"]*)"/g) ?? [];
		const offenders = stringAttrs
			.map((attr) => attr.slice(attr.indexOf('"') + 1, attr.lastIndexOf('"')))
			.filter((value) => /^(?:[A-Z]|Enter |e\.g\.|Driver )/.test(value));
		expect(offenders).toEqual([]);

		for (const [key] of CATALOG_ENTRIES) {
			expect(source).toContain(`m.${key}`);
		}
	});
});
