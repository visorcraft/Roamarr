import { parseArgs } from 'node:util';

const { values } = parseArgs({
	options: {
		email: { type: 'string' },
		password: { type: 'string' }
	},
	strict: false,
	allowPositionals: true
});

const email = values.email ?? process.env.SEED_EMAIL;
const password = values.password ?? process.env.SEED_PASSWORD;

if (values.password) {
	console.warn(
		'Warning: --password is visible in process lists. Prefer the SEED_PASSWORD environment variable.'
	);
}

if (!email || !password) {
	console.error(
		'Usage: node scripts/seed-database.mjs --email <email> --password <password>\n' +
		'   or: SEED_EMAIL=<email> SEED_PASSWORD=<password> node scripts/seed-database.mjs'
	);
	process.exit(1);
}

if (!process.env.ROAMARR_SECRET) {
	console.error('Error: ROAMARR_SECRET is required');
	process.exit(1);
}

const { DatabaseSeeder } = await import('../src/lib/server/seedDatabase.ts');
const seeder = new DatabaseSeeder({ email, password });
await seeder.run();
