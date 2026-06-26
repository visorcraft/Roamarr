import attribution from './licenseData.generated.json';

export type LicenseDocumentId = 'project' | 'third-party' | 'acknowledgements' | 'runtime';

export interface LicenseDocument {
	id: LicenseDocumentId;
	title: string;
	subtitle: string;
	body: string;
	lineCount: number;
	href: string;
}

export interface CreditPackage {
	name: string;
	version: string;
	license: string;
	scope: 'production' | 'development';
	url: string;
	packagePath: string;
}

export interface RuntimeComponent {
	name: string;
	licenses: string;
	url: string;
	usage: string;
}

const licenseData = attribution as {
	projectLicense: {
		title: string;
		subtitle: string;
		body: string;
		lineCount: number;
	};
	thirdPartyLicensesText: string;
	acknowledgementsText: string;
	runtimeLicensesText: string;
	packages: CreditPackage[];
	runtimeComponents: RuntimeComponent[];
	counts: {
		packages: number;
		productionPackages: number;
		developmentPackages: number;
		runtimeComponents: number;
	};
	source: {
		packageName: string;
		packageVersion: string;
		lockfileSha256: string;
	};
};

function countLines(text: string) {
	return text.length ? text.split('\n').length : 0;
}

function hrefFor(id: LicenseDocumentId) {
	return id === 'project' ? '/settings/about/licenses' : `/settings/about/licenses?tab=${id}`;
}

export function getLicenseDocuments(): LicenseDocument[] {
	return [
		{
			id: 'project',
			title: licenseData.projectLicense.title,
			subtitle: licenseData.projectLicense.subtitle,
			body: licenseData.projectLicense.body,
			lineCount: licenseData.projectLicense.lineCount,
			href: hrefFor('project')
		},
		{
			id: 'third-party',
			title: 'Third-party licenses',
			subtitle: 'Bundled npm package license text generated from package-lock.json and installed package metadata.',
			body: licenseData.thirdPartyLicensesText,
			lineCount: countLines(licenseData.thirdPartyLicensesText),
			href: hrefFor('third-party')
		},
		{
			id: 'acknowledgements',
			title: 'Acknowledgements',
			subtitle: 'Attribution summary for Roamarr, npm packages, and runtime components.',
			body: licenseData.acknowledgementsText,
			lineCount: countLines(licenseData.acknowledgementsText),
			href: hrefFor('acknowledgements')
		},
		{
			id: 'runtime',
			title: 'Runtime components',
			subtitle: 'Runtime and deployment components used by common Roamarr installations.',
			body: licenseData.runtimeLicensesText,
			lineCount: countLines(licenseData.runtimeLicensesText),
			href: hrefFor('runtime')
		}
	];
}

export function getLicenseDocument(id: string | null | undefined): LicenseDocument {
	const normalized = id === 'third-party' || id === 'acknowledgements' || id === 'runtime' ? id : 'project';
	return getLicenseDocuments().find((doc) => doc.id === normalized)!;
}

export function getCreditsData() {
	return {
		packages: licenseData.packages,
		runtimeComponents: licenseData.runtimeComponents,
		counts: licenseData.counts,
		source: licenseData.source
	};
}
