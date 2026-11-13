const { Client } = require('pg');

async function run() {
  const client = new Client({
    host: 'ep-royal-breeze-b3hh1nod-pooler.c-4.ap-southeast-1.aws.neon.tech',
    database: 'neondb',
    user: 'neondb_owner',
    password: 'npg_de1KYpBc7CXi',
    port: 5432,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const cols = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'locations'
  `);
  console.log('Columns in locations:', cols.rows.map(c => c.column_name).join(', '));

  const res = await client.query(`
    SELECT id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, 
           speed, accuracy, heading, recorded_at, battery_level
    FROM locations
    WHERE recorded_at >= NOW() - INTERVAL '30 minutes'
    ORDER BY recorded_at ASC
    LIMIT 120
  `);

  console.log('Total points in last 30 minutes:', res.rows.length);

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  for (let i = 0; i < res.rows.length; i++) {
    const r = res.rows[i];
    let d = 0, dt = 0, realSpd = 0;
    if (i > 0) {
      const prev = res.rows[i-1];
      d = haversine(prev.lat, prev.lng, r.lat, r.lng);
      dt = (new Date(r.recorded_at) - new Date(prev.recorded_at)) / 1000;
      realSpd = dt > 0 ? (d / dt) * 3.6 : 0;
    }
    const timeCol = new Date(r.recorded_at).toLocaleTimeString('en-US', { timeZone: 'Asia/Colombo' });
    console.log(
      `[#${r.id}] ${timeCol} | RepSpd: ${(r.speed * 3.6).toFixed(1).padStart(5)} km/h | CalcSpd: ${realSpd.toFixed(1).padStart(5)} km/h | Dist: ${d.toFixed(1).padStart(5)}m | dt: ${dt.toFixed(1)}s | Acc: ${Number(r.accuracy).toFixed(1)}m`
    );
  }

  await client.end();
}

run().catch(console.error);
