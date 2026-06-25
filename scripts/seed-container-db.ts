import { seedDemoData } from '../src/lib/server/seed';
import { db } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';

const admin = db.select().from(users).where(eq(users.role, 'admin')).get();
if (!admin) {
	console.error('No admin user found');
	process.exit(1);
}

const result = seedDemoData(admin.id);
console.log('Seeded:', result.trips.map((t) => t.name).join(', '));
