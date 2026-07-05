export type IconName =
	| 'home'
	| 'trips'
	| 'document'
	| 'reminder'
	| 'loyalty'
	| 'card'
	| 'insurance'
	| 'group'
	| 'notification'
	| 'settings'
	| 'logout'
	| 'menu'
	| 'more-horizontal'
	| 'search'
	| 'info'
	| 'plus'
	| 'back'
	| 'calendar'
	| 'share'
	| 'location'
	| 'arrow-right'
	| 'chevron-down'
	| 'import'
	| 'export'
	| 'user'
	| 'users'
	| 'close'
	| 'check'
	| 'empty'
	| 'flight'
	| 'print'
	| 'edit'
	| 'duplicate'
	| 'star'
	| 'archive'
	| 'copy'
	| 'dietary'
	| 'allergies'
	| 'medical'
	| 'poll'
	| 'budget'
	| 'attachment'
	| 'sun'
	| 'cloud-sun'
	| 'cloud-drizzle'
	| 'cloud-rain'
	| 'cloud-snow'
	| 'cloud-lightning'
	| 'fog';

export const ICON_PATHS: Record<IconName, string> = {
	home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
	trips: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
	document:
		'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
	reminder: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
	loyalty: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
	card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
	insurance:
		'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
	group:
		'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
	notification:
		'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
	settings:
		'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
	logout:
		'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
	menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
	'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
	search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
	info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
	plus: '<path d="M5 12h14M12 5v14"/>',
	back: '<path d="m15 18-6-6 6-6"/>',
	calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
	share:
		'<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
	location:
		'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
	'arrow-right': '<path d="M5 12h14"/><path d="m13 7 6 5-6 5"/>',
	'chevron-down': '<path d="m6 9 6 6 6-6"/>',
	import: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M7 11l5 5 5-5"/><path d="M12 4v12"/>',
	export: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M7 9l5-5 5 5"/><path d="M12 4v12"/>',
	user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
	users:
		'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
	close: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
	check: '<polyline points="20 6 9 17 4 12"/>',
	empty: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
	flight:
		'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
	print:
		'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
	edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
	duplicate:
		'<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
	star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>',
	archive:
		'<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
	copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
	dietary:
		'<path d="M6 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2"/><path d="M10 2v12"/><path d="M20 10V2v0a4 4 0 0 0-4 4v4a2 2 0 0 0 2 2h2Zm0 0v10"/>',
	allergies:
		'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
	medical: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
	poll: '<path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M11 16V8"/><path d="M15 16v-6"/><path d="M19 16v-2"/>',
	budget:
		'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a3 3 0 0 0 0 6 3 3 0 0 0 0-6z"/>',
	attachment:
		'<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M2 12h2m16 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
	'cloud-sun':
		'<path d="M17.5 19c2.48 0 4.5-2.02 4.5-4.5S19.98 10 17.5 10c-.24 0-.47.02-.7.06A6.5 6.5 0 0 0 4.5 13.5C4.5 16.54 7.02 19 10.5 19h7z"/><circle cx="8" cy="8" r="2.5"/><path d="M8 4.5v1m0 5v1M5.5 8h1m3 0h1"/>',
	'cloud-drizzle':
		'<path d="M17.5 17c2.48 0 4.5-2.02 4.5-4.5S19.98 8 17.5 8c-.24 0-.47.02-.7.06A6.5 6.5 0 0 0 4.5 11.5C4.5 14.54 7.02 17 10.5 17h7z"/><path d="M8 19v1m4-1v1m4-1v1"/>',
	'cloud-rain':
		'<path d="M17.5 17c2.48 0 4.5-2.02 4.5-4.5S19.98 8 17.5 8c-.24 0-.47.02-.7.06A6.5 6.5 0 0 0 4.5 11.5C4.5 14.54 7.02 17 10.5 17h7z"/><path d="M8 19v2m4-2v2m4-2v2"/>',
	'cloud-snow':
		'<path d="M17.5 17c2.48 0 4.5-2.02 4.5-4.5S19.98 8 17.5 8c-.24 0-.47.02-.7.06A6.5 6.5 0 0 0 4.5 11.5C4.5 14.54 7.02 17 10.5 17h7z"/><path d="M8 20h.01M12 20h.01M16 20h.01"/>',
	'cloud-lightning':
		'<path d="M17.5 17c2.48 0 4.5-2.02 4.5-4.5S19.98 8 17.5 8c-.24 0-.47.02-.7.06A6.5 6.5 0 0 0 4.5 11.5C4.5 14.54 7.02 17 10.5 17h7z"/><path d="M13 19l-2 3h3l-2 3"/>',
	fog: '<path d="M4 15h16M4 12h16M4 9h16"/>'
};
