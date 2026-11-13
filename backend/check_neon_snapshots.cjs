const { Client } = require('pg');
const client = new Client({
  host: 'ep-royal-breeze-b3hh1nod-pooler.c-4.ap-southeast-1.aws.neon.tech',
  database: 'neondb',
  user: 'neondb_owner',
  password: 'npg_de1KYpBc7CXi',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  const res = await client.query(`
    SELECT id, child_id, media_type, file_name, mime_type, file_size_bytes, duration_seconds, recorded_at, created_at 
    FROM media_snapshots 
    ORDER BY created_at DESC 
    LIMIT 5
  `);
  console.log('Snapshots count:', res.rows.length);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

main().catch(console.error);
