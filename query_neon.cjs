const { Client } = require('pg');

async function check() {
  const client = new Client({
    host: 'ep-royal-breeze-b3hh1nod-pooler.c-4.ap-southeast-1.aws.neon.tech',
    database: 'neondb',
    user: 'neondb_owner',
    password: 'npg_de1KYpBc7CXi',
    port: 5432,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const children = await client.query('SELECT c.id, c.name, cd.id as device_id, cd.battery_level, cd.is_charging, cd.last_seen FROM children c LEFT JOIN child_devices cd ON cd.child_id = c.id');
  console.log('Children & Devices:');
  console.table(children.rows);

  const lastPoints = await client.query(`
    SELECT DISTINCT ON (child_id) child_id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, speed, accuracy, battery_level, is_charging, recorded_at
    FROM locations
    ORDER BY child_id, recorded_at DESC
  `);
  console.log('\nLast Location per child:');
  console.table(lastPoints.rows.map(r => ({
    ...r,
    time: new Date(r.recorded_at).toLocaleString('en-US', { timeZone: 'Asia/Colombo' })
  })));

  await client.end();
}

check().catch(console.error);
