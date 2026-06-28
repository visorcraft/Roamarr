process.env.ROAMARR_SECRET = 'dGVzdC1zZWNyZXQtMzJieXRlcy0wMTIzNDU2Nzg5YWI=';
// Tests mock `$lib/server/db` with per-test temp MongrelDB directories (see
// tests/helpers.ts `freshDb`). This value is only the configured path string
// surfaced by the About page; it is a MongrelDB data directory, not a file.
process.env.MONGREL_DATABASE_PATH = './roamarr-test.kitdb';
