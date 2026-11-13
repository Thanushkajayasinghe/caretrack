import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: 'ep-royal-breeze-b3hh1nod-pooler.c-4.ap-southeast-1.aws.neon.tech',
  database: 'neondb',
  user: 'neondb_owner',
  password: 'npg_de1KYpBc7CXi',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const cols = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'locations'
  `);
  console.log('Columns in locations:');
  console.table(cols.rows);

  const count = await client.query(`
    SELECT COUNT(*) 
    FROM locations 
    WHERE child_id = '61c28caa-9f3a-4d47-a613-b1cf47d5d462'
      AND ST_DWithin(
        location, 
        ST_SetSRID(ST_MakePoint(80.000837, 6.415661), 4326)::geography, 
        15
      )
  `);
  console.log('Duplicate stationary points at table location:', count.rows[0].count);

  // Keep the latest 5 points and delete the rest of the 1000+ duplicate stationary points
  const deleteRes = await client.query(`
    DELETE FROM locations 
    WHERE id IN (
      SELECT id FROM locations 
      WHERE child_id = '61c28caa-9f3a-4d47-a613-b1cf47d5d462'
        AND ST_DWithin(
          location, 
          ST_SetSRID(ST_MakePoint(80.000837, 6.415661), 4326)::geography, 
          15
        )
      ORDER BY recorded_at DESC 
      OFFSET 5
    )
  `);
  console.log('Pruned duplicate stationary rows:', deleteRes.rowCount);

  const remaining = await client.query('SELECT COUNT(*) FROM locations');
  console.log('Total remaining location rows in DB:', remaining.rows[0].count);

  await client.end();
}
run().catch(console.error);
