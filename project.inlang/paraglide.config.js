/** @type {import('@inlang/paraglide-js').ParaglideConfig} */
export default {
	outdir: './src/lib/paraglide',
	emitTsDeclarations: true,
	// No URL prefixes or locale cookie: the browser language decides, English is the fallback.
	strategy: ['preferredLanguage', 'baseLocale']
};
