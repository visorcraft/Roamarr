import { TRIP_STATUSES, SEGMENT_TYPES, TRAVEL_DOCUMENT_TYPES } from './db/mongrelSchema';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const MCP_TOOL_DEFINITIONS: Tool[] = [
	{
		name: 'roamarr_trip_list',
		description:
			'List trips you can view, including ones shared with you. Cursor-paginated. status follows dates in your profile timezone: completed after the end date, active while today falls on the trip (the end date still counts as current). A saved planning, booked, active, or completed value is not overwritten.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			}
		}
	},
	{
		name: 'roamarr_trip_get',
		description: 'Get details of a specific trip including segments and itinerary.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number', description: 'Trip ID' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_trip_create',
		description: 'Create a new trip.',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				destination: { type: 'string' },
				destinationCountryCode: { type: 'string' },
				destinationAdmin1Code: {
					type: 'string',
					description: 'State/province/territory (GeoNames admin1 code, e.g. TX, ON)'
				},
				destinationCityName: { type: 'string' }, destinationCityLat: { type: 'number' }, destinationCityLng: { type: 'number' },
				startDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
				endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' }, notes: { type: 'string' },
				tags: { type: 'array', items: { type: 'string' } }, baseCurrency: { type: 'string' },
				defaultVisibility: { type: 'string', enum: ['private', 'shared', 'public'] }, status: { type: 'string', enum: [...TRIP_STATUSES] }
			},
			required: ['name']
		}
	},
	{
		name: 'roamarr_trip_update',
		description: 'Update an existing trip (name, destination, dates, etc.).',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				name: { type: 'string' },
				destination: { type: 'string' },
				destinationCountryCode: { type: 'string' },
				destinationAdmin1Code: {
					type: 'string',
					description: 'State/province/territory (GeoNames admin1 code, e.g. TX, ON)'
				},
				destinationCityName: { type: 'string' },
				destinationCityLat: { type: 'number' }, destinationCityLng: { type: 'number' },
				startDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
				endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
				notes: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, baseCurrency: { type: 'string' },
				defaultVisibility: { type: 'string', enum: ['private', 'shared', 'public'] }, status: { type: 'string', enum: [...TRIP_STATUSES] }
			},
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_day_plan',
		description:
			'Create a segment on a trip. Times are LOCAL WALL CLOCK in startTz/endTz (not UTC instants). Pass IANA zones for every non-UTC place (e.g. America/Chicago, Asia/Bangkok, Asia/Seoul). Stored value is the UTC instant of that local time; the UI shows the wall clock in the zone.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				type: { type: 'string', description: 'Segment type: flight, hotel, event, restaurant, etc.' },
				title: { type: 'string' },
				startAt: {
					type: 'string',
					description:
						'Local wall-clock start in startTz: YYYY-MM-DDTHH:mm[:ss]. Digits are the clock face at the place (e.g. "2026-12-01T22:50:00" for 10:50 PM Dallas). Do not convert to UTC yourself. A trailing Z or ±offset is ignored; digits are still interpreted in startTz.'
				},
				startTz: {
					type: 'string',
					description:
						'IANA timezone for startAt wall clock (default UTC). Use airport/hotel local zone: America/Chicago, Asia/Bangkok, Asia/Taipei, Asia/Seoul, etc.'
				},
				endAt: {
					type: 'string',
					description:
						'Local wall-clock end in endTz (same rules as startAt). For flights, use the arrival airport local time with endTz set to that airport zone.'
				},
				endTz: {
					type: 'string',
					description: 'IANA timezone for endAt wall clock (defaults to startTz).'
				},
				cityName: { type: 'string' },
				countryCode: { type: 'string' },
				admin1Code: {
					type: 'string',
					description: 'State/province/territory (GeoNames admin1 code) when applicable'
				},
				cityLat: { type: 'number' },
				cityLng: { type: 'number' },
				location: { type: 'string' },
				venue: { type: 'string', description: 'Venue or street address shown in the itinerary editor' },
				confirmationNumber: { type: 'string' },
				notes: { type: 'string' },
				details: { type: 'object' },
				paymentStatus: { type: 'string', enum: ['quoted', 'deposit_paid', 'fully_paid', 'refunded'] }
			},
			required: ['tripId', 'type', 'title', 'startAt']
		}
	},
	{
		name: 'roamarr_packing_item_add',
		description: 'Add an item to a trip\u2019s packing checklist.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				text: { type: 'string', description: 'Item description, e.g. "Passport" or "Sunscreen"' }, assignedToCompanionId: { type: 'number' }
			},
			required: ['tripId', 'text']
		}
	},
	{
		name: 'roamarr_packing_list_build',
		description: 'Apply a saved packing template to a trip, or list the current checklist.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				templateId: { type: 'number', description: 'Optional template ID to apply. Omit to just list current items.' }
			},
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_budget_set',
		description: 'Set or update a budget category amount for a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				category: { type: 'string', description: 'Budget category (e.g. lodging, transport, food, activities, other)' },
				amount: { type: 'integer', description: 'Budget amount in integer cents (e.g. $150.00 → 15000); must be greater than 0' },
				currency: { type: 'string', description: '3-letter ISO currency code (case-insensitive), default USD' }
			},
			required: ['tripId', 'category', 'amount']
		}
	},
	{
		name: 'roamarr_budget_update',
		description: 'View the current budget categories and spent amounts for a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' }
			},
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_upcoming_summary',
		description: 'Get a summary of upcoming trips.',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'roamarr_weather_overview',
		description: 'Get the weather forecast for a trip destination.',
		inputSchema: { type: 'object', properties: { tripId: { type: 'number' } }, required: ['tripId'] }
	},
	{
		name: 'roamarr_places_list',
		description: 'List visited countries and U.S. states. Cursor-paginated across both collections.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			}
		}
	},
	{
		name: 'roamarr_places_mark',
		description: 'Mark a country or U.S. state as visited.',
		inputSchema: {
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['country', 'state'] },
				code: { type: 'string', description: 'ISO country code or US state code' }
			},
			required: ['kind', 'code']
		}
	},
	{
		name: 'roamarr_places_unmark',
		description: 'Remove a country or U.S. state from visited.',
		inputSchema: {
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['country', 'state'] },
				code: { type: 'string', description: 'ISO country code or US state code' }
			},
			required: ['kind', 'code']
		}
	},
	{
		name: 'roamarr_reminder_add',
		description: 'Add a reminder to a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				offsetMinutes: { type: 'integer', minimum: -10080, maximum: 10080, description: 'Minutes before the trip start' },
				title: { type: 'string' }, reminderType: { type: 'string', enum: ['trip', 'document'] },
				name: { type: 'string' }, description: { type: 'string' }, fireAt: { type: 'string' }, refId: { type: 'number' }
			},
			required: []
		}
	},
	// Round 1: trip planning vertical — 17 new tools.
	{
		name: 'roamarr_segment_update',
		description:
			'Update a segment. When changing times, pass LOCAL WALL CLOCK + IANA zone (same contract as roamarr_day_plan). Do not pre-convert to UTC; trailing Z/offset on startAt/endAt is ignored.',
		inputSchema: {
			type: 'object',
			properties: {
				segmentId: { type: 'number' },
				type: { type: 'string', enum: [...SEGMENT_TYPES] },
				title: { type: 'string' },
				startAt: {
					type: 'string',
					description:
						'Local wall-clock start in startTz: YYYY-MM-DDTHH:mm[:ss]. Digits are the clock face at the place. Do not convert to UTC. Trailing Z/offset is ignored.'
				},
				startTz: {
					type: 'string',
					description: 'IANA timezone for startAt wall clock (e.g. America/Chicago, Asia/Bangkok).'
				},
				endAt: {
					type: 'string',
					description: 'Local wall-clock end in endTz (same rules as startAt).'
				},
				endTz: {
					type: 'string',
					description: 'IANA timezone for endAt wall clock.'
				},
				cityName: { type: 'string' },
				countryCode: { type: 'string' },
				admin1Code: {
					type: 'string',
					description: 'State/province/territory (GeoNames admin1 code) when applicable'
				},
				cityLat: { type: 'number' },
				cityLng: { type: 'number' },
				location: { type: 'string' },
				venue: { type: 'string', description: 'Venue or street address shown in the itinerary editor' },
				confirmationNumber: { type: 'string' },
				notes: { type: 'string' },
				details: { type: 'object' },
				paymentStatus: { type: 'string', enum: ['quoted', 'deposit_paid', 'fully_paid', 'refunded'] }
			},
			required: ['segmentId']
		}
	},
	{
		name: 'roamarr_segment_delete',
		description: 'Delete a segment. Cancels its reminders.',
		inputSchema: {
			type: 'object',
			properties: { segmentId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['segmentId']
		}
	},
	{
		name: 'roamarr_segment_move',
		description: 'Reschedule a segment to a new date. Time-of-day is preserved; only the calendar date changes. To change the time too, use roamarr_segment_update.',
		inputSchema: {
			type: 'object',
			properties: {
				segmentId: { type: 'number' },
				targetDate: { type: 'string', description: 'ISO date YYYY-MM-DD' }
			},
			required: ['segmentId', 'targetDate']
		}
	},
	{
		name: 'roamarr_segment_status',
		description: 'Set the lifecycle status of a segment.',
		inputSchema: {
			type: 'object',
			properties: {
				segmentId: { type: 'number' },
				status: { type: 'string', enum: ['planned', 'checked_in', 'boarded', 'arrived', 'completed'] }
			},
			required: ['segmentId', 'status']
		}
	},
	{
		name: 'roamarr_trip_day_optimize',
		description:
			'Optimize the visiting order of one trip day using nearest-neighbor + 2-opt over haversine distances. Only untimed (date-only, midnight start) segments with coordinates are reordered; timed segments keep their time order. Without confirm: true this returns the proposed order as a preview and changes nothing; with confirm: true the new per-day order is persisted.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				date: { type: 'string', description: 'ISO date YYYY-MM-DD (local trip day)' },
				confirm: { type: 'boolean', description: 'Must be true to apply the optimized order' }
			},
			required: ['tripId', 'date']
		}
	},
	{
		name: 'roamarr_trip_day_directions_url',
		description:
			'Build a Google Maps directions URL for one trip day from its coordinate-bearing segments in display order (untimed by optimized order first, then timed by local time). Returns null when the day has fewer than two mappable points.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				date: { type: 'string', description: 'ISO date YYYY-MM-DD (local trip day)' }
			},
			required: ['tripId', 'date']
		}
	},
	{
		name: 'roamarr_trip_delete',
		description: 'Permanently delete a trip. Cancels all reminders and shares. Cannot be undone.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				confirm: { type: 'boolean', description: 'Must be true to confirm destructive action' }
			},
			required: ['tripId', 'confirm']
		}
	},
	{
		name: 'roamarr_trip_archive',
		description: 'Toggle the archived flag on a trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_trip_duplicate',
		description: 'Duplicate a trip including its segments (not companions, shares, or comments).',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_expense_create',
		description: 'Record an expense. amount is in integer cents (e.g. $12.34 → 1234).',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				description: { type: 'string' },
				amount: { type: 'integer', description: 'Amount in integer cents' },
				currency: { type: 'string', description: 'ISO currency code, default USD' },
				category: { type: 'string', description: 'lodging, transport, food, activities, other' },
				exchangeRate: { type: 'integer', description: 'Rate × 10000 (default 10000 = 1.0)' },
				baseAmount: { type: 'integer', description: 'Amount in cents in base currency' },
				paidByCompanionId: { type: 'number' },
				splitAmong: { type: 'array', items: { oneOf: [{ type: 'string', enum: ['owner'] }, { type: 'number' }] } }
			},
			required: ['tripId', 'description', 'amount']
		}
	},
	{
		name: 'roamarr_expense_list',
		description: 'List expenses for a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			},
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_expense_update',
		description: 'Update an expense by id.',
		inputSchema: {
			type: 'object',
			properties: {
				expenseId: { type: 'number' },
				description: { type: 'string' },
				amount: { type: 'integer' },
				currency: { type: 'string' },
				category: { type: 'string' },
				exchangeRate: { type: 'integer', description: 'Rate × 10000 (10000 = 1.0)' },
				baseAmount: { type: 'integer', description: 'Amount in cents in base currency' },
				paidByCompanionId: { type: 'number' },
				splitAmong: { type: 'array', items: { oneOf: [{ type: 'string', enum: ['owner'] }, { type: 'number' }] } }
			},
			required: ['expenseId']
		}
	},
	{
		name: 'roamarr_expense_delete',
		description: 'Delete an expense.',
		inputSchema: {
			type: 'object',
			properties: { expenseId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['expenseId']
		}
	},
	{
		name: 'roamarr_packing_item_toggle',
		description: 'Toggle the packed/unpacked state of a checklist item.',
		inputSchema: {
			type: 'object',
			properties: { itemId: { type: 'number' } },
			required: ['itemId']
		}
	},
	{
		name: 'roamarr_packing_item_update',
		description: 'Rename a packing checklist item.',
		inputSchema: {
			type: 'object',
			properties: {
				itemId: { type: 'number' },
				text: { type: 'string' }, assignedToCompanionId: { type: 'number' }
			},
			required: ['itemId']
		}
	},
	{
		name: 'roamarr_packing_item_delete',
		description: 'Delete a packing checklist item.',
		inputSchema: {
			type: 'object',
			properties: { itemId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['itemId']
		}
	},
	{
		name: 'roamarr_reminder_list',
		description: 'List your reminders. Optionally filter by tripId.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				limit: { type: 'integer' },
				cursor: { type: 'string' }
			}
		}
	},
	{
		name: 'roamarr_reminder_update',
		description: 'Update a reminder. Pass either the raw fields (name, description, fireAt, refId) or the custom fields (title, customNote, offsetMinutes) in one call, not a mix of both.',
		inputSchema: {
			type: 'object',
			properties: {
				reminderId: { type: 'number' },
				title: { type: 'string', maxLength: 200 },
				customNote: { type: 'string', maxLength: 1000 },
				offsetMinutes: { type: 'integer', minimum: -10080, maximum: 10080 },
				name: { type: 'string' }, description: { type: 'string' }, fireAt: { type: 'string' }, refId: { type: 'number' }
			},
			required: ['reminderId']
		}
	},
	{
		name: 'roamarr_reminder_delete',
		description: 'Delete a reminder by id.',
		inputSchema: {
			type: 'object',
			properties: { reminderId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['reminderId']
		}
	},
	// ---- Round 2: wallet, sharing, calendar, contacts, profile, notifications ----
	{
		name: 'roamarr_card_list',
		description: 'List your payment cards (network + last4 only; never full PAN). Cursor-paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			}
		}
	},
	{
		name: 'roamarr_card_create',
		description: 'Add a payment card. last4 only; never pass full PAN.',
		inputSchema: {
			type: 'object',
			properties: {
				network: { type: 'string', enum: ['visa', 'mc', 'amex', 'disc', 'other'] },
				last4: { type: 'string', description: '4 digits' },
				label: { type: 'string' }
			},
			required: ['network', 'last4']
		}
	},
	{
		name: 'roamarr_card_update',
		description: 'Update a card by id.',
		inputSchema: {
			type: 'object',
			properties: { cardId: { type: 'number' }, label: { type: 'string' } },
			required: ['cardId']
		}
	},
	{
		name: 'roamarr_card_delete',
		description: 'Delete a card by id.',
		inputSchema: {
			type: 'object',
			properties: { cardId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['cardId']
		}
	},
	{
		name: 'roamarr_loyalty_list',
		description: 'List your loyalty programs. Member numbers are redacted by default. Cursor-paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			}
		}
	},
	{
		name: 'roamarr_loyalty_create',
		description: 'Add a loyalty program.',
		inputSchema: {
			type: 'object',
			properties: {
				programName: { type: 'string' },
				memberNumber: { type: 'string' }
			},
			required: ['programName']
		}
	},
	{
		name: 'roamarr_loyalty_update',
		description: 'Update a loyalty program by id.',
		inputSchema: {
			type: 'object',
			properties: {
				loyaltyId: { type: 'number' },
				programName: { type: 'string' },
				memberNumber: { type: 'string' }
			},
			required: ['loyaltyId']
		}
	},
	{
		name: 'roamarr_loyalty_delete',
		description: 'Delete a loyalty program by id.',
		inputSchema: {
			type: 'object',
			properties: { loyaltyId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['loyaltyId']
		}
	},
	{
		name: 'roamarr_insurance_list',
		description: 'List your insurance policies. Policy numbers and notes redacted by default. Cursor-paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			}
		}
	},
	{
		name: 'roamarr_insurance_create',
		description: 'Add an insurance policy.',
		inputSchema: {
			type: 'object',
			properties: {
				provider: { type: 'string' },
				policyNumber: { type: 'string' },
				coverageType: { type: 'string' },
				notes: { type: 'string' }
			},
			required: ['provider']
		}
	},
	{
		name: 'roamarr_insurance_update',
		description: 'Update an insurance policy by id.',
		inputSchema: {
			type: 'object',
			properties: {
				insuranceId: { type: 'number' },
				provider: { type: 'string' },
				policyNumber: { type: 'string' },
				notes: { type: 'string' }
			},
			required: ['insuranceId']
		}
	},
	{
		name: 'roamarr_insurance_delete',
		description: 'Delete an insurance policy by id.',
		inputSchema: {
			type: 'object',
			properties: { insuranceId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['insuranceId']
		}
	},
	{
		name: 'roamarr_travel_doc_list',
		description: 'List your travel documents (passport, visa, etc.). Encrypted numbers redacted. Cursor-paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			}
		}
	},
	{
		name: 'roamarr_travel_doc_create',
		description: 'Add a travel document. number is encrypted at rest.',
		inputSchema: {
			type: 'object',
			properties: {
				type: { type: 'string', enum: [...TRAVEL_DOCUMENT_TYPES] },
				issuer: { type: 'string' },
				number: { type: 'string' },
				expiresOn: { type: 'string', description: 'ISO date' }
			},
			required: ['type']
		}
	},
	{
		name: 'roamarr_travel_doc_update',
		description: 'Update a travel document by id.',
		inputSchema: {
			type: 'object',
			properties: {
				docId: { type: 'number' },
				issuer: { type: 'string' },
				number: { type: 'string' },
				expiresOn: { type: 'string' }
			},
			required: ['docId']
		}
	},
	{
		name: 'roamarr_travel_doc_delete',
		description: 'Delete a travel document by id.',
		inputSchema: {
			type: 'object',
			properties: { docId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['docId']
		}
	},
	{
		name: 'roamarr_doc_link_list',
		description: 'List per-trip document links for a trip. Cursor-paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			},
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_doc_link_create',
		description: 'Attach a document link to a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				label: { type: 'string' }, url: { type: 'string' }, notes: { type: 'string' }
			},
			required: ['tripId', 'label', 'url']
		}
	},
	{
		name: 'roamarr_doc_link_update',
		description: 'Update a doc link by id.',
		inputSchema: {
			type: 'object',
			properties: {
				linkId: { type: 'number' },
				label: { type: 'string' }, url: { type: 'string' }, notes: { type: 'string' }
			},
			required: ['linkId']
		}
	},
	{
		name: 'roamarr_doc_link_delete',
		description: 'Delete a doc link by id.',
		inputSchema: {
			type: 'object',
			properties: { linkId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['linkId']
		}
	},
	{
		name: 'roamarr_share_list',
		description: 'List shares on a trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_share_create',
		description: 'Share a trip with a user (by email), group, or as a public link.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				kind: { type: 'string', enum: ['user', 'group', 'public'] },
				email: { type: 'string' },
				groupId: { type: 'number' },
				permission: { type: 'string', enum: ['read', 'edit'] },
				showDetails: { type: 'boolean' }
			},
			required: ['tripId', 'kind']
		}
	},
	{
		name: 'roamarr_share_update',
		description: 'Update a share by id (permission, showDetails).',
		inputSchema: {
			type: 'object',
			properties: {
				shareId: { type: 'number' },
				permission: { type: 'string', enum: ['read', 'edit'] },
				showDetails: { type: 'boolean' }
			},
			required: ['shareId']
		}
	},
	{
		name: 'roamarr_share_revoke',
		description: 'Revoke a share by id.',
		inputSchema: {
			type: 'object',
			properties: { shareId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['shareId']
		}
	},
	{
		name: 'roamarr_group_list',
		description: 'List your sharing groups.',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'roamarr_group_create',
		description: 'Create a sharing group.',
		inputSchema: {
			type: 'object',
			properties: { name: { type: 'string' } },
			required: ['name']
		}
	},
	{
		name: 'roamarr_group_member_add',
		description: 'Add a user to a group by email.',
		inputSchema: {
			type: 'object',
			properties: {
				groupId: { type: 'number' },
				email: { type: 'string' }
			},
			required: ['groupId', 'email']
		}
	},
	{
		name: 'roamarr_group_member_remove',
		description: 'Remove a user from a group by id.',
		inputSchema: {
			type: 'object',
			properties: {
				groupId: { type: 'number' },
				userId: { type: 'number' },
				confirm: { type: 'boolean', description: 'Must be true to confirm destructive action' }
			},
			required: ['groupId', 'userId']
		}
	},
	{
		name: 'roamarr_calendar_rotate_token',
		description: 'Rotate the calendar feed token for a trip. Old token is revoked.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_contact_list',
		description: 'List your emergency contacts.',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'roamarr_contact_create',
		description: 'Add an emergency contact.',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				relationship: { type: 'string' },
				phone: { type: 'string' },
				email: { type: 'string' }, isPrimary: { type: 'boolean' }
			},
			required: ['name']
		}
	},
	{
		name: 'roamarr_contact_update',
		description: 'Update an emergency contact by id.',
		inputSchema: {
			type: 'object',
			properties: {
				contactId: { type: 'number' },
				name: { type: 'string' },
				relationship: { type: 'string' },
				phone: { type: 'string' },
				email: { type: 'string' }, isPrimary: { type: 'boolean' }
			},
			required: ['contactId']
		}
	},
	{
		name: 'roamarr_contact_delete',
		description: 'Delete an emergency contact by id.',
		inputSchema: {
			type: 'object',
			properties: { contactId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['contactId']
		}
	},
	{
		name: 'roamarr_profile_get',
		description: 'Get your profile preferences (timezone, default leads, currency, theme).',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'roamarr_profile_update',
		description: 'Update your profile preferences.',
		inputSchema: {
			type: 'object',
			properties: {
				displayName: { type: 'string' },
				timezone: { type: 'string' },
				defaultCurrency: { type: 'string' },
				flightCheckinLeadHours: { type: 'integer' },
				documentExpiryLeadDays: { type: 'integer' },
				mailHoldLeadDays: { type: 'integer' },
				themeId: { type: 'string' },
				temperatureUnit: { type: 'string', enum: ['c', 'f'] },
				timeFormat: { type: 'string', enum: ['12h', '24h'] }
			}
		}
	},
	{
		name: 'roamarr_notification_channels_get',
		description: 'Get your notification channel preferences (email/webhook/ntfy).',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'roamarr_notification_channels_update',
		description: 'Update your notification channel preferences.',
		inputSchema: {
			type: 'object',
			properties: {
				emailNotifications: { type: 'boolean' },
				webhookNotifications: { type: 'boolean' },
				ntfyNotifications: { type: 'boolean' }
			}
		}
	},
	{
		name: 'roamarr_user_smtp_get',
		description: 'Get your SMTP override (no password exposed).',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'roamarr_user_smtp_set',
		description: 'Set your SMTP override.',
		inputSchema: {
			type: 'object',
			properties: {
				host: { type: 'string' },
				port: { type: 'integer' },
				username: { type: 'string' },
				password: { type: 'string' },
				fromAddress: { type: 'string' },
				security: { type: 'string', enum: ['none', 'starttls', 'ssl/tls'] }
			},
			required: ['host', 'port', 'username', 'fromAddress']
		}
	},
	{
		name: 'roamarr_user_smtp_clear',
		description: 'Clear your SMTP override.',
		inputSchema: { type: 'object', properties: {
		confirm: { type: "boolean", description: "Must be true to confirm destructive action" },} }
	},
	// ---- Round 4: saved places library ----
	{
		name: 'roamarr_saved_places_list',
		description: 'List your saved places (POI library), optionally filtered. Cursor-paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				categoryId: { type: 'number' },
				status: { type: 'string', enum: ['planned', 'visited'] },
				favorite: { type: 'boolean' },
				q: { type: 'string', description: 'Free-text search over name/address/notes' },
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			}
		}
	},
	{
		name: 'roamarr_saved_places_get',
		description: 'Get one saved place by id.',
		inputSchema: {
			type: 'object',
			properties: { placeId: { type: 'number' } },
			required: ['placeId']
		}
	},
	{
		name: 'roamarr_saved_places_create',
		description: 'Create a saved place. priceCents is minor currency units.',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				categoryId: { type: 'number' },
				address: { type: 'string' },
				cityId: { type: 'number', description: 'GeoNames geoname_id' },
				lat: { type: 'number' },
				lng: { type: 'number' },
				durationMin: { type: 'integer' },
				priceCents: { type: 'integer' },
				description: { type: 'string' },
				status: { type: 'string', enum: ['planned', 'visited'] },
				favorite: { type: 'boolean' }
			},
			required: ['name']
		}
	},
	{
		name: 'roamarr_saved_places_update',
		description: 'Update a saved place by id. Only provided fields change.',
		inputSchema: {
			type: 'object',
			properties: {
				placeId: { type: 'number' },
				name: { type: 'string' },
				categoryId: { type: 'number', nullable: true },
				address: { type: 'string', nullable: true },
				cityId: { type: 'number', nullable: true },
				lat: { type: 'number', nullable: true },
				lng: { type: 'number', nullable: true },
				durationMin: { type: 'integer', nullable: true },
				priceCents: { type: 'integer', nullable: true },
				description: { type: 'string', nullable: true },
				status: { type: 'string', enum: ['planned', 'visited'] },
				favorite: { type: 'boolean' }
			},
			required: ['placeId']
		}
	},
	{
		name: 'roamarr_saved_places_delete',
		description: 'Delete a saved place by id.',
		inputSchema: {
			type: 'object',
			properties: { placeId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['placeId']
		}
	},
	{
		name: 'roamarr_saved_places_mark_visited',
		description: 'Mark a saved place as visited (records visited timestamp).',
		inputSchema: {
			type: 'object',
			properties: { placeId: { type: 'number' } },
			required: ['placeId']
		}
	},
	{
		name: 'roamarr_saved_places_unmark_visited',
		description: 'Return a visited saved place to planned.',
		inputSchema: {
			type: 'object',
			properties: { placeId: { type: 'number' } },
			required: ['placeId']
		}
	},
	{
		name: 'roamarr_place_category_list',
		description: 'List your saved-place categories (seeds defaults on first use).',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'roamarr_place_category_create',
		description: 'Create a saved-place category. color is a hex value like #2f9e44.',
		inputSchema: {
			type: 'object',
			properties: { name: { type: 'string' }, color: { type: 'string' } },
			required: ['name']
		}
	},
	{
		name: 'roamarr_place_category_update',
		description: 'Rename and/or recolor a saved-place category. Omitted fields keep their current value.',
		inputSchema: {
			type: 'object',
			properties: { categoryId: { type: 'number' }, name: { type: 'string' }, color: { type: 'string' } },
			required: ['categoryId']
		}
	},
	{
		name: 'roamarr_place_category_delete',
		description: 'Delete a saved-place category. Places in it are kept but unlinked.',
		inputSchema: {
			type: 'object',
			properties: { categoryId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['categoryId']
		}
	},
	{
		name: 'roamarr_saved_places_search',
		description: 'Search OpenStreetMap (Nominatim) for a place to save; returns name/address/coords candidates.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				limit: { type: 'integer', description: '1-20, default 8' }
			},
			required: ['query']
		}
	},
	{
		name: 'roamarr_saved_places_import',
		description: 'Bulk-import saved places from structured rows. Duplicates (exact name or within 50 m) are skipped by default.',
		inputSchema: {
			type: 'object',
			properties: {
				rows: {
					type: 'array',
					description: 'Up to 10,000 rows',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							lat: { type: 'number' },
							lng: { type: 'number' },
							address: { type: 'string' },
							description: { type: 'string' },
							category: { type: 'string', description: 'Category name matched case-insensitively against existing categories' }
						},
						required: ['name']
					}
				},
				categoryId: { type: 'number', description: 'Bulk category override for every imported row' },
				skipDuplicates: { type: 'boolean', description: 'Default true' },
				confirm: { type: 'boolean', description: 'Must be true to confirm the bulk import' }
			},
			required: ['rows', 'confirm']
		}
	},
	{
		name: 'roamarr_place_links_list',
		description: 'List external links attached to a saved place. Cursor-paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				placeId: { type: 'number' },
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			},
			required: ['placeId']
		}
	},
	{
		name: 'roamarr_place_links_create',
		description: 'Attach an external link (http/https URL) to a saved place.',
		inputSchema: {
			type: 'object',
			properties: {
				placeId: { type: 'number' },
				label: { type: 'string' }, url: { type: 'string' }, notes: { type: 'string' }
			},
			required: ['placeId', 'label', 'url']
		}
	},
	{
		name: 'roamarr_place_links_update',
		description: 'Update a saved-place link by id. Only provided fields change.',
		inputSchema: {
			type: 'object',
			properties: {
				linkId: { type: 'number' },
				label: { type: 'string' }, url: { type: 'string' }, notes: { type: 'string', nullable: true }
			},
			required: ['linkId']
		}
	},
	{
		name: 'roamarr_place_links_delete',
		description: 'Delete a saved-place link by id.',
		inputSchema: {
			type: 'object',
			properties: { linkId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['linkId']
		}
	},
	// ---- Round 3: depth + UX ----
	{
		name: 'roamarr_packing_template_list',
		description: 'List your packing templates.',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'roamarr_packing_template_create',
		description: 'Create a packing template from a trip checklist.',
		inputSchema: {
			type: 'object',
			properties: { name: { type: 'string' }, sourceTripId: { type: 'number' } },
			required: ['name', 'sourceTripId']
		}
	},
	{
		name: 'roamarr_packing_template_delete',
		description: 'Delete a packing template.',
		inputSchema: {
			type: 'object',
			properties: { templateId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['templateId']
		}
	},
	{
		name: 'roamarr_trip_template_list',
		description: 'List your trip templates.',
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'roamarr_trip_template_create',
		description: 'Create a trip template from an owned trip.',
		inputSchema: {
			type: 'object',
			properties: { name: { type: 'string' }, sourceTripId: { type: 'number' } },
			required: ['name', 'sourceTripId']
		}
	},
	{
		name: 'roamarr_trip_template_apply',
		description: 'Apply a trip template to create a new trip.',
		inputSchema: {
			type: 'object',
			properties: { templateId: { type: 'number' } },
			required: ['templateId']
		}
	},
	{
		name: 'roamarr_trip_template_delete',
		description: 'Delete a trip template.',
		inputSchema: {
			type: 'object',
			properties: { templateId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['templateId']
		}
	},
	{
		name: 'roamarr_companion_list',
		description: 'List companions for a trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_companion_create',
		description: 'Add a companion to a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				name: { type: 'string' },
				category: { type: 'string', enum: ['adult', 'child', 'other', 'guide', 'driver'] },
				dietary: { type: 'string' }, allergies: { type: 'string' }, medicalNotes: { type: 'string' },
				needsCarSeat: { type: 'boolean' }, needsStroller: { type: 'boolean' }, needsCrib: { type: 'boolean' }, needsKidsMeal: { type: 'boolean' },
				childTicketDiscount: { type: 'string' }, seatPreference: { type: 'string' }, bedPreference: { type: 'string' },
				accessibilityNeeds: { type: 'string' }, roomNotes: { type: 'string' }, notes: { type: 'string' }
			},
			required: ['tripId', 'name']
		}
	},
	{
		name: 'roamarr_companion_update',
		description: 'Update a companion by id.',
		inputSchema: {
			type: 'object',
			properties: {
				companionId: { type: 'number' },
				name: { type: 'string' },
				category: { type: 'string', enum: ['adult', 'child', 'other', 'guide', 'driver'] },
				dietary: { type: 'string' }, allergies: { type: 'string' }, medicalNotes: { type: 'string' },
				needsCarSeat: { type: 'boolean' }, needsStroller: { type: 'boolean' }, needsCrib: { type: 'boolean' }, needsKidsMeal: { type: 'boolean' },
				childTicketDiscount: { type: 'string' }, seatPreference: { type: 'string' }, bedPreference: { type: 'string' },
				accessibilityNeeds: { type: 'string' }, roomNotes: { type: 'string' }, notes: { type: 'string' }
			},
			required: ['companionId']
		}
	},
	{
		name: 'roamarr_companion_delete',
		description: 'Delete a companion by id.',
		inputSchema: {
			type: 'object',
			properties: { companionId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['companionId']
		}
	},
	{
		name: 'roamarr_poll_list',
		description: 'List polls for a trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_poll_create',
		description: 'Create a poll for a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				question: { type: 'string' },
				options: { type: 'array', items: { type: 'string' } }
			},
			required: ['tripId', 'question', 'options']
		}
	},
	{
		name: 'roamarr_poll_cast_vote',
		description: 'Cast a vote on a poll option.',
		inputSchema: {
			type: 'object',
			properties: {
				pollId: { type: 'number' },
				optionId: { type: 'number' },
				companionId: { type: 'number' }
			},
			required: ['pollId', 'optionId']
		}
	},
	{
		name: 'roamarr_poll_delete',
		description: 'Delete a poll by id.',
		inputSchema: {
			type: 'object',
			properties: { pollId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['pollId']
		}
	},
	{
		name: 'roamarr_journal_list',
		description: 'List journal entries for a trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_journal_create',
		description: 'Create a journal entry for a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				entryDate: { type: 'string', description: 'ISO date' },
				title: { type: 'string' },
				body: { type: 'string' }
			},
			required: ['tripId', 'entryDate', 'title', 'body']
		}
	},
	{
		name: 'roamarr_journal_update',
		description: 'Update a journal entry by id.',
		inputSchema: {
			type: 'object',
			properties: {
				entryId: { type: 'number' },
				entryDate: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }
			},
			required: ['entryId']
		}
	},
	{
		name: 'roamarr_journal_delete',
		description: 'Delete a journal entry by id.',
		inputSchema: {
			type: 'object',
			properties: { entryId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['entryId']
		}
	},
	{
		name: 'roamarr_trip_day_notes_list',
		description: 'List per-day notes for a trip itinerary.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_trip_day_notes_set',
		description: 'Set (upsert) the note for one trip day.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				date: { type: 'string', description: 'Local trip day, YYYY-MM-DD' },
				icon: { type: 'string', description: 'Optional icon name (document, info, warning, star, reminder); omit or empty for none' },
				body: { type: 'string' }
			},
			required: ['tripId', 'date', 'body']
		}
	},
	{
		name: 'roamarr_trip_day_notes_delete',
		description: 'Delete the note for one trip day.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' }, date: { type: 'string', description: 'Local trip day, YYYY-MM-DD' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['tripId', 'date']
		}
	},
	{
		name: 'roamarr_home_task_list',
		description: 'List home tasks for a trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_home_task_create',
		description: 'Create a home task for a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				text: { type: 'string', description: 'Task text, 1-200 characters' },
				dueDate: { type: 'string', description: 'Optional due date, YYYY-MM-DD' }
			},
			required: ['tripId', 'text']
		}
	},
	{
		name: 'roamarr_home_task_toggle_done',
		description: 'Toggle the done flag on a home task.',
		inputSchema: {
			type: 'object',
			properties: { taskId: { type: 'number' } },
			required: ['taskId']
		}
	},
	{
		name: 'roamarr_home_task_delete',
		description: 'Delete a home task by id.',
		inputSchema: {
			type: 'object',
			properties: { taskId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['taskId']
		}
	},
	{
		name: 'roamarr_mail_hold_list',
		description: 'List mail holds for a trip the caller can edit. Holds show when a home is empty, so read-only collaborators, public share links, and calendar feeds do not receive them.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_mail_hold_create',
		description: 'Create a mail hold for a trip. Carrier defaults to USPS. endDate must be on or after startDate. A USPS hold longer than 30 days is saved and returned with a warning.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				carrier: { type: 'string' },
				startDate: { type: 'string', description: 'YYYY-MM-DD' },
				endDate: { type: 'string', description: 'YYYY-MM-DD' },
				confirmationNumber: { type: 'string' },
				addressLabel: { type: 'string' },
				notes: { type: 'string' },
				status: { type: 'string', enum: ['requested', 'active', 'ended', 'cancelled'] }
			},
			required: ['tripId', 'startDate', 'endDate']
		}
	},
	{
		name: 'roamarr_mail_hold_update',
		description: 'Update a mail hold. Omitted fields stay as they are. Rescheduling or cancelling replaces the end reminder.',
		inputSchema: {
			type: 'object',
			properties: {
				holdId: { type: 'number' },
				carrier: { type: 'string' },
				startDate: { type: 'string' },
				endDate: { type: 'string' },
				confirmationNumber: { type: 'string' },
				addressLabel: { type: 'string' },
				notes: { type: 'string' },
				status: { type: 'string', enum: ['requested', 'active', 'ended', 'cancelled'] }
			},
			required: ['holdId']
		}
	},
	{
		name: 'roamarr_mail_hold_delete',
		description: 'Delete a mail hold and its end reminder.',
		inputSchema: {
			type: 'object',
			properties: {
				holdId: { type: 'number' },
				confirm: { type: 'boolean', description: 'Must be true to confirm destructive action' }
			},
			required: ['holdId']
		}
	},
	{
		name: 'roamarr_mail_hold_coverage',
		description: 'Report uncovered away days, each hold renewal date, and a suggested next 30-day window. Requires edit access to the trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_medication_list',
		description: 'List medications for a trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_medication_create',
		description: 'Add a medication to a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				name: { type: 'string' },
				companionId: { type: 'number' }, dosage: { type: 'string' }, schedule: { type: 'string' },
				startsAt: { type: 'string' }, endsAt: { type: 'string' }, notes: { type: 'string' }
			},
			required: ['tripId', 'name']
		}
	},
	{
		name: 'roamarr_medication_delete',
		description: 'Delete a medication by id.',
		inputSchema: {
			type: 'object',
			properties: { medicationId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['medicationId']
		}
	},
	{
		name: 'roamarr_important_item_list',
		description: 'List important items (valuables, trackers).',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_important_item_create',
		description: 'Add an important item to a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				name: { type: 'string' }, companionId: { type: 'number' }, serialNumber: { type: 'string' },
				trackerId: { type: 'string' }, notes: { type: 'string' }
			},
			required: ['tripId', 'name']
		}
	},
	{
		name: 'roamarr_important_item_delete',
		description: 'Delete an important item by id.',
		inputSchema: {
			type: 'object',
			properties: { itemId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['itemId']
		}
	},
	{
		name: 'roamarr_entry_requirement_list',
		description: 'List entry requirements for a trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_entry_requirement_create',
		description: 'Add an entry requirement to a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				country: { type: 'string' }, requirementType: { type: 'string', enum: ['visa', 'vaccination', 'other'] },
				status: { type: 'string', enum: ['needed', 'in_progress', 'complete', 'not_needed'] }, dueDate: { type: 'string' }, notes: { type: 'string' }
			},
			required: ['tripId', 'country', 'requirementType']
		}
	},
	{
		name: 'roamarr_entry_requirement_update',
		description: 'Update an entry requirement by id.',
		inputSchema: {
			type: 'object',
			properties: {
				requirementId: { type: 'number' },
				status: { type: 'string', enum: ['needed', 'in_progress', 'complete', 'not_needed'] },
				dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD; an empty string clears it' },
				notes: { type: 'string', description: 'Free-text notes (max 2000 characters)' }
			},
			required: ['requirementId']
		}
	},
	{
		name: 'roamarr_entry_requirement_delete',
		description: 'Delete an entry requirement by id.',
		inputSchema: {
			type: 'object',
			properties: { requirementId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['requirementId']
		}
	},
	{
		name: 'roamarr_comment_list',
		description: 'List comments on a trip.',
		inputSchema: {
			type: 'object',
			properties: { tripId: { type: 'number' } },
			required: ['tripId']
		}
	},
	{
		name: 'roamarr_comment_create',
		description: 'Post a comment on a trip.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				body: { type: 'string' }
			},
			required: ['tripId', 'body']
		}
	},
	{
		name: 'roamarr_comment_delete',
		description: 'Delete a comment by id.',
		inputSchema: {
			type: 'object',
			properties: { commentId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['commentId']
		}
	},
	{
		name: 'roamarr_search',
		description:
			'Search across your trips, segments, and saved places. Uses contextual semantic ranking (local MiniLM + MongrelDB ANN) when an admin has enabled embeddings; otherwise substring match on name, destination, and segment titles. Returns trips plus optional hits[] (place hits carry a place projection with name, category, coordinates, and status) and a semantic flag.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Natural-language or keyword query (e.g. "spring cherry blossoms in Japan" or "Tokyo").'
				}
			},
			required: ['query']
		}
	},
	{
		name: 'roamarr_gallery_list',
		description:
			'List gallery photos for a saved place or a trip (captions and order). Image upload is web-only; MCP cannot transfer binary files.',
		inputSchema: {
			type: 'object',
			properties: {
				ownerType: { type: 'string', enum: ['place', 'trip'] },
				ownerId: { type: 'number' }
			},
			required: ['ownerType', 'ownerId']
		}
	},
	{
		name: 'roamarr_gallery_remove',
		description: 'Remove a gallery photo and delete its stored image.',
		inputSchema: {
			type: 'object',
			properties: { imageId: { type: 'number' },
			confirm: { type: "boolean", description: "Must be true to confirm destructive action" },},
			required: ['imageId']
		}
	},
	{
		name: 'roamarr_gallery_reorder',
		description:
			'Reorder a gallery. imageIds must list every current image id exactly once, in the desired order.',
		inputSchema: {
			type: 'object',
			properties: {
				ownerType: { type: 'string', enum: ['place', 'trip'] },
				ownerId: { type: 'number' },
				imageIds: { type: 'array', items: { type: 'number' } }
			},
			required: ['ownerType', 'ownerId', 'imageIds']
		}
	},
	{
		name: 'roamarr_gallery_set_caption',
		description: 'Set or clear (empty string) the caption of a gallery photo.',
		inputSchema: {
			type: 'object',
			properties: {
				imageId: { type: 'number' },
				caption: { type: 'string', description: 'Up to 200 characters; empty clears' }
			},
			required: ['imageId', 'caption']
		}
	},
	{
		name: 'roamarr_attachment_upload',
		description:
			'Upload a PDF, JPEG, PNG, WebP, or GPX file onto a trip or one itinerary segment (the trip Documents tab). Pass tripId, segmentId, or both. contentBase64 is the raw file bytes (standard or URL-safe base64). No size limit. Optional label (200 characters) and notes (2000). This is not an expense receipt or a gallery photo.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number', description: 'Trip to attach the file to. Optional when segmentId is set.' },
				segmentId: {
					type: 'number',
					description: 'Itinerary segment on that trip. Omit for a whole-trip file.'
				},
				filename: { type: 'string', description: 'Original file name, without a directory.' },
				mimeType: {
					type: 'string',
					description: 'image/jpeg, image/png, image/webp, application/pdf, or a GPX type for a .gpx file.'
				},
				contentBase64: { type: 'string', description: 'Base64-encoded file bytes.' },
				label: { type: 'string', description: 'Optional display label, up to 200 characters. Defaults to the filename.' },
				notes: { type: 'string', description: 'Optional notes, up to 2000 characters.' }
			},
			required: ['filename', 'mimeType', 'contentBase64']
		}
	},
	{
		name: 'roamarr_attachment_list',
		description:
			'List files attached to a trip or one segment. Pass tripId, segmentId, or both. Cursor-paginated. Each id is the trip document id used by roamarr_attachment_get and roamarr_attachment_delete.',
		inputSchema: {
			type: 'object',
			properties: {
				tripId: { type: 'number' },
				segmentId: { type: 'number', description: 'When set, only files on this segment are returned.' },
				limit: { type: 'integer', description: '1-200, default 50' },
				cursor: { type: 'string' }
			}
		}
	},
	{
		name: 'roamarr_attachment_get',
		description:
			'Read one trip or segment file by documentId. Always returns metadata. Set includeContent to true to also return the full file as contentBase64, whatever its size. Optional offset and length (bytes) return just that slice for clients that prefer chunked reads; the result reports totalBytes, contentOffset, contentBytes, complete, and nextOffset.',
		inputSchema: {
			type: 'object',
			properties: {
				documentId: { type: 'number', description: 'Trip document id from roamarr_attachment_list.' },
				tripId: { type: 'number', description: 'Optional. When set, the file must belong to this trip.' },
				includeContent: {
					type: 'boolean',
					description: 'When true, include the file bytes as base64. The whole file is returned unless offset/length are set.'
				},
				offset: {
					type: 'integer',
					description: 'Optional first byte to return (0-based). Default 0. Only used with includeContent.'
				},
				length: {
					type: 'integer',
					description: 'Optional maximum number of bytes to return from offset. Default: through the end of the file.'
				}
			},
			required: ['documentId']
		}
	},
	{
		name: 'roamarr_attachment_delete',
		description: 'Delete a trip or segment file by documentId. Requires confirm: true.',
		inputSchema: {
			type: 'object',
			properties: {
				documentId: { type: 'number' },
				tripId: { type: 'number', description: 'Optional. When set, the file must belong to this trip.' },
				confirm: { type: 'boolean', description: 'Must be true to confirm this destructive action.' }
			},
			required: ['documentId']
		}
	}
];
