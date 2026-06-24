export const SEGMENT_TYPES = [
	'flight',
	'lodging',
	'car',
	'rail',
	'activity',
	'cruise',
	'event',
	'hotel',
	'rental_car',
	'note',
	'todo',
	'parking',
	'boat',
	'train',
	'directions',
	'food',
	'poi',
	'meetup',
	'rideshare',
	'shuttle'
] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

export const SEG = {
	flight: {
		label: 'Flight',
		icon: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>'
	},
	lodging: {
		label: 'Lodging',
		icon: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>'
	},
	car: {
		label: 'Car',
		icon: '<path d="M3 16v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/><path d="M3 16h18v2H3z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>'
	},
	rail: {
		label: 'Rail',
		icon: '<path d="M4 16V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9"/><path d="M4 16h16"/><path d="M6 20l-2 3"/><path d="M18 20l2 3"/><path d="M6 9h12"/>'
	},
	activity: {
		label: 'Activity',
		icon: '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.5"/>'
	},
	cruise: {
		label: 'Cruise',
		icon: '<path d="M4 16c0 3 4 5 8 5s8-2 8-5"/><path d="M3 16l1-4h16l1 4"/><path d="M8 12V8h8v4"/><path d="M12 8V5"/><path d="M8 5h8"/>'
	},
	event: {
		label: 'Event',
		icon: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'
	},
	hotel: {
		label: 'Hotel',
		icon: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>'
	},
	rental_car: {
		label: 'Rental car',
		icon: '<path d="M3 16v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3"/><path d="M3 16h18v2H3z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>'
	},
	note: {
		label: 'Note',
		icon: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v5h5"/>'
	},
	todo: {
		label: 'Todo item',
		icon: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>'
	},
	parking: {
		label: 'Parking',
		icon: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 8h4a2 2 0 0 1 0 4H9V8Z"/>'
	},
	boat: {
		label: 'Boat',
		icon: '<path d="M4 16c0 3 4 5 8 5s8-2 8-5"/><path d="M3 16l1-4h16l1 4"/><path d="M8 12V8h8v4"/>'
	},
	train: {
		label: 'Train',
		icon: '<path d="M4 16V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9"/><path d="M4 16h16"/><path d="M6 20l-2 3"/><path d="M18 20l2 3"/><path d="M6 9h12"/>'
	},
	directions: {
		label: 'Directions',
		icon: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>'
	},
	food: {
		label: 'Food',
		icon: '<path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>'
	},
	poi: {
		label: 'Point of interest',
		icon: '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.5"/>'
	},
	meetup: {
		label: 'Meet Up',
		icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
	},
	rideshare: {
		label: 'Rideshare',
		icon: '<path d="M3 16v-3a2 2 0 0 1 2-2h11l2 2h2a2 2 0 0 1 2 2v3"/><path d="M3 16h18v2H3z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/><path d="M16 11h3l2 2"/>'
	},
	shuttle: {
		label: 'Shuttle',
		icon: '<path d="M4 16V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8"/><path d="M4 16h16"/><path d="M6 20v2"/><path d="M18 20v2"/><path d="M8 6h8"/><path d="M8 10h3"/><path d="M13 10h3"/>'
	}
} as const satisfies Record<SegmentType, { label: string; icon: string }>;

/** Types shown in the add-segment wizard (step 1). */
export const ADD_SEGMENT_WIZARD_TYPES = [
	{ type: 'event', label: 'Event' },
	{ type: 'flight', label: 'Flight' },
	{ type: 'hotel', label: 'Hotel' },
	{ type: 'rental_car', label: 'Rental car' },
	{ type: 'note', label: 'Note' },
	{ type: 'todo', label: 'Todo item' },
	{ type: 'parking', label: 'Parking' },
	{ type: 'boat', label: 'Boat' },
	{ type: 'train', label: 'Train' },
	{ type: 'directions', label: 'Directions' },
	{ type: 'food', label: 'Food' },
	{ type: 'poi', label: 'Point of interest' },
	{ type: 'meetup', label: 'Meet Up' },
	{ type: 'rideshare', label: 'Rideshare' },
	{ type: 'shuttle', label: 'Shuttle' }
] as const satisfies ReadonlyArray<{ type: SegmentType; label: string }>;

export function segmentLabel(type: string) {
	return SEG[type as SegmentType]?.label ?? type;
}
