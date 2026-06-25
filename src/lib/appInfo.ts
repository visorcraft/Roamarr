import pkg from '../../package.json';

function displayNameFromPackageName(name: string) {
	const unscoped = name.split('/').at(-1) ?? name;
	return unscoped
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export const appInfo = {
	name: displayNameFromPackageName(pkg.name),
	version: pkg.version
};
