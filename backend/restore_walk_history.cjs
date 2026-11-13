const { Pool } = require('pg');
const Redis = require('ioredis');
require('dotenv').config({ path: 'd:/Projects/CareTrack/backend/.env' });

async function main() {
  const childId = '9e2e8c12-d7b0-4110-afc7-6bf197fa13e2';
  const redis = new Redis(process.env.REDIS_URL || 'redis://red-cvpldol6l47c73cqo2ig:6379');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const rawList = await redis.lrange(`child:trail:${childId}`, 0, -1);
  console.log(`Found ${rawList.length} points in Redis trail for ${childId}`);

  let inserted = 0;
  for (const itemStr of rawList) {
    try {
      const pt = JSON.parse(itemStr);
      const recDate = new Date(pt.recorded_at || pt.recordedAt);
      const query = `
        INSERT INTO locations (child_id, location, accuracy, speed, heading, altitude, battery_level, is_charging, recorded_at)
        VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (child_id, recorded_at) DO NOTHING
      `;
      const res = await pool.query(query, [
        childId,
        pt.lng,
        pt.lat,
        pt.accuracy || null,
        pt.speed != null ? pt.speed : null,
        pt.heading != null ? pt.heading : null,
        pt.altitude != null ? pt.altitude : null,
        pt.battery_level != null ? pt.battery_level : 100,
        pt.is_charging != null ? pt.is_charging : false,
        recDate
      ]);
      inserted += (res.rowCount || 0);
    } catch (e) {
      console.error('Error inserting point:', e.message);
    }
  }

  console.log(`Successfully inserted ${inserted} points into PostgreSQL locations table!`);
  await pool.end();
  redis.disconnect();
}

main().catch(console.error);
