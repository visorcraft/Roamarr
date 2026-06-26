import { requireUser } from '$lib/server/auth';
import { getLicenseDocument, getLicenseDocuments } from '$lib/server/licenseAttribution';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	requireUser(locals);
	const activeTab = url.searchParams.get('tab');
	const currentDocument = getLicenseDocument(activeTab);

	return {
		activeTab: currentDocument.id,
		tabs: getLicenseDocuments().map(({ id, title, subtitle, lineCount, href }) => ({
			id,
			title,
			subtitle,
			lineCount,
			href
		})),
		currentDocument
	};
};
