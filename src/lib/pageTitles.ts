import { m } from '$lib/paraglide/messages';

/**
 * Page names for the browser tab, keyed by SvelteKit route id. The root layout owns the one
 * `<title>` and composes it as `Page name · instanceName`; pages do not render their own
 * `<title>`, so the layout's reactive title can never overwrite (or be left behind by) a page's.
 *
 * Each entry receives the merged page data (`page.data`), for titles that name the record shown.
 * A route without an entry gets the bare instance name. `pageTitles.test.ts` fails when a page
 * route is missing here.
 */
type PageData = Record<string, unknown>;
type PageName = (data: PageData) => string;

function tripName(data: PageData): string | undefined {
	const trip = data.trip as { name?: unknown } | undefined;
	return typeof trip?.name === 'string' && trip.name.trim() ? trip.name : undefined;
}

const generalTabs: Record<string, () => string> = {
	general: m.page_title_configuration,
	maps: m.page_title_configuration_maps,
	email: m.page_title_configuration_email,
	webhook: m.page_title_configuration_webhooks,
	oauth: m.page_title_configuration_mcp_clients
};

export const PAGE_TITLES: Record<string, PageName> = {
	'/': () => m.page_title_dashboard(),
	'/about': () => m.page_title_about(),
	'/about/credits': () => m.page_title_about_credits(),
	'/about/licenses': () => m.page_title_about_licenses(),
	'/audit-logs': () => m.page_title_audit_logs(),
	'/audit-logs/[id]': () => m.page_title_audit_log_entry(),
	'/backup': () => m.page_title_backup(),
	'/boot-error': () => m.page_title_boot_error(),
	'/cards': () => m.page_title_cards(),
	'/cards/[id]/edit': () => m.page_title_card_edit(),
	'/cards/new': () => m.page_title_card_new(),
	'/database-maintenance': () => m.page_title_database_maintenance(),
	'/fare-providers': () => m.page_title_fare_providers(),
	'/fare-providers/[id]/edit': () => m.page_title_fare_provider_edit(),
	'/fare-providers/new': () => m.page_title_fare_provider_new(),
	'/forgot-password': () => m.page_title_forgot_password(),
	// `/general` still serves the legacy `?tab=` links, so the name follows the tab shown.
	'/general': (data) => (generalTabs[data.tab as string] ?? generalTabs.general)(),
	'/general/email': () => m.page_title_configuration_email(),
	'/general/maps': () => m.page_title_configuration_maps(),
	'/general/mcp-clients': () => m.page_title_configuration_mcp_clients(),
	'/general/webhooks': () => m.page_title_configuration_webhooks(),
	'/groups': () => m.page_title_groups(),
	'/groups/[id]/edit': () => m.page_title_group_edit(),
	'/groups/new': () => m.page_title_group_new(),
	'/insurance': () => m.page_title_insurance(),
	'/insurance/[id]/edit': () => m.page_title_insurance_edit(),
	'/insurance/new': () => m.page_title_insurance_new(),
	'/invite/[token]': () => m.page_title_invite(),
	'/job-history': () => m.page_title_job_history(),
	'/login': () => m.page_title_login(),
	'/login/verify': () => m.page_title_login_verify(),
	'/notifications': () => m.page_title_notifications(),
	'/oauth/authorize': () => m.page_title_oauth_authorize(),
	'/places': () => m.page_title_places(),
	'/places/import': () => m.page_title_places_import(),
	'/profile': () => m.page_title_profile(),
	'/profile/api-keys': () => m.page_title_api_keys(),
	'/profile/calendar': () => m.page_title_calendar_feed(),
	'/profile/change-password': () => m.page_title_change_password(),
	'/profile/contacts': () => m.page_title_emergency_contacts(),
	'/profile/documents': () => m.page_title_documents(),
	'/profile/documents/[id]/edit': () => m.page_title_document_edit(),
	'/profile/documents/new': () => m.page_title_document_new(),
	'/profile/email': () => m.page_title_profile_email(),
	'/profile/email_parsing': () => m.page_title_email_settings(),
	'/profile/email_processing': () => m.page_title_email_settings(),
	'/profile/email_sender': () => m.page_title_email_settings(),
	'/profile/loyalty': () => m.page_title_loyalty(),
	'/profile/loyalty/[id]/edit': () => m.page_title_loyalty_edit(),
	'/profile/loyalty/new': () => m.page_title_loyalty_new(),
	'/profile/mcp-clients': () => m.page_title_mcp_clients(),
	'/profile/reminders': () => m.page_title_reminders(),
	'/profile/reminders/[id]/edit': () => m.page_title_reminder_edit(),
	'/profile/reminders/new': () => m.page_title_reminder_new(),
	'/profile/security': () => m.page_title_security(),
	'/profile/sessions': () => m.page_title_sessions(),
	'/profile/theme': () => m.page_title_theme(),
	'/profile/visited/countries': () => m.page_title_visited_countries(),
	'/profile/visited/states': () => m.page_title_visited_states(),
	'/register': () => m.page_title_register(),
	'/reset-password/[token]': () => m.page_title_reset_password(),
	'/search': () => m.page_title_search(),
	'/seed': () => m.page_title_seed(),
	'/setup': () => m.page_title_setup(),
	'/share/[token]': (data) => tripName(data) ?? m.page_title_shared_trip(),
	'/trips': () => m.page_title_trips(),
	'/trips/[id]': (data) => tripName(data) ?? m.page_title_trip(),
	'/trips/[id]/edit': () => m.page_title_trip_edit(),
	'/trips/[id]/print': (data) => {
		const trip = tripName(data);
		return trip ? m.page_title_trip_print({ trip }) : m.page_title_trip_print_untitled();
	},
	'/trips/[id]/segments/new': () => m.page_title_segment_new(),
	'/trips/[id]/segments/new/boat': () => m.page_title_segment_new_boat(),
	'/trips/[id]/segments/new/directions': () => m.page_title_segment_new_directions(),
	'/trips/[id]/segments/new/event': () => m.page_title_segment_new_event(),
	'/trips/[id]/segments/new/flight': () => m.page_title_segment_new_flight(),
	'/trips/[id]/segments/new/food': () => m.page_title_segment_new_food(),
	'/trips/[id]/segments/new/hotel': () => m.page_title_segment_new_hotel(),
	'/trips/[id]/segments/new/meetup': () => m.page_title_segment_new_meetup(),
	'/trips/[id]/segments/new/note': () => m.page_title_segment_new_note(),
	'/trips/[id]/segments/new/parking': () => m.page_title_segment_new_parking(),
	'/trips/[id]/segments/new/poi': () => m.page_title_segment_new_poi(),
	'/trips/[id]/segments/new/rental_car': () => m.page_title_segment_new_rental_car(),
	'/trips/[id]/segments/new/rideshare': () => m.page_title_segment_new_rideshare(),
	'/trips/[id]/segments/new/shuttle': () => m.page_title_segment_new_shuttle(),
	'/trips/[id]/segments/new/todo': () => m.page_title_segment_new_todo(),
	'/trips/[id]/segments/new/train': () => m.page_title_segment_new_train(),
	'/trips/[id]/share': () => m.page_title_trip_share(),
	'/trips/import': () => m.page_title_trips_import(),
	'/trips/merge': () => m.page_title_trips_merge(),
	'/trips/new': () => m.page_title_trip_new(),
	'/users': () => m.page_title_users(),
	'/users/[id]/edit': () => m.page_title_user_edit(),
	'/users/new': () => m.page_title_user_new()
};

/**
 * Routes whose page name is the whole title, without ` · instanceName`. The printable itinerary's
 * title is the browser's default "Save as PDF" filename, so it stays the trip name alone.
 */
export const STANDALONE_TITLES: ReadonlySet<string> = new Set(['/trips/[id]/print']);

/**
 * The tab title: `Page name · instanceName`, or the bare instance name for unlisted routes. When
 * the page failed to load (`page.error` is set), `page.route.id` still names the route but the
 * error page is what renders, so the title is the bare instance name as well.
 */
export function pageTitle(
	routeId: string | null,
	data: PageData,
	instanceName: string | null | undefined,
	error: unknown = null
): string {
	const instance = instanceName || 'Roamarr';
	const name = routeId && !error ? PAGE_TITLES[routeId]?.(data) : undefined;
	if (!name) return instance;
	return STANDALONE_TITLES.has(routeId!) ? name : m.page_title({ page: name, instance });
}
