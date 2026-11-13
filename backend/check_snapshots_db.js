import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM media_snapshots ORDER BY created_at DESC LIMIT 5');
    console.log('Snapshots count:', res.rows.length);
    console.log(JSON.stringify(res.rows, null, 2));
  } finally {
    client.release();
    pool.end();
  }
}

main().catch(console.error);
