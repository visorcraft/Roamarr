export const SEGMENT_TYPES = ['flight', 'lodging', 'car', 'rail', 'activity', 'cruise'] as const;
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
	}
} as const satisfies Record<SegmentType, { label: string; icon: string }>;
