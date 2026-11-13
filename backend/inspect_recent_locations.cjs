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
    SELECT 
      id,
      child_id,
      ST_Y(location::geometry) as lat,
      ST_X(location::geometry) as lng,
      accuracy,
      speed,
      heading,
      recorded_at,
      synced_at
    FROM locations
    ORDER BY recorded_at DESC
    LIMIT 35
  `);
  console.log('Most recent 35 rows in locations table:');
  console.table(res.rows.map(r => ({
    lat: r.lat ? Number(r.lat).toFixed(6) : null,
    lng: r.lng ? Number(r.lng).toFixed(6) : null,
    acc: r.accuracy,
    speed_mps: r.speed != null ? Number(r.speed).toFixed(2) : null,
    speed_kmh: r.speed != null ? (Number(r.speed) * 3.6).toFixed(1) : null,
    recorded_at: r.recorded_at ? new Date(r.recorded_at).toISOString() : null,
    synced_at: r.synced_at ? new Date(r.synced_at).toISOString() : null
  })));

  const total = await client.query('SELECT COUNT(*) FROM locations');
  console.log('Total location rows:', total.rows[0].count);

  await client.end();
}
main().catch(console.error);
