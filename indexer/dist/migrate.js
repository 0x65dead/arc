import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const { Client } = pg;
async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('Missing DATABASE_URL — set it in .env before running migrate.');
        process.exit(1);
    }
    // Resolved against cwd rather than import.meta.url, since tsc's dist/
    // output location shouldn't matter — this only needs to find schema.sql
    // at the project root, which is wherever `npm run migrate` is invoked from.
    const schemaPath = path.resolve(process.cwd(), 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
        console.error(`Could not find schema.sql at ${schemaPath}`);
        process.exit(1);
    }
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    console.log('[migrate] connecting...');
    await client.connect();
    console.log('[migrate] applying schema.sql...');
    await client.query(sql);
    console.log('[migrate] done.');
    await client.end();
}
main().catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
});
