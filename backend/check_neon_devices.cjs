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
    SELECT id, child_id, device_name, is_active, last_seen, battery_level 
    FROM child_devices 
    ORDER BY last_seen DESC 
    LIMIT 5
  `);
  console.log('Child devices:');
  console.log(JSON.stringify(res.rows, null, 2));

  const children = await client.query('SELECT id, name, parent_id FROM children LIMIT 5');
  console.log('Children:');
  console.log(JSON.stringify(children.rows, null, 2));

  try {
    const callLogs = await client.query('SELECT count(*) as count FROM call_logs;');
    console.log('Call logs count in Neon:', callLogs.rows[0]?.count);
    const sampleCalls = await client.query('SELECT * FROM call_logs ORDER BY timestamp DESC LIMIT 5;');
    console.log('Sample call logs:', sampleCalls.rows);
  } catch (err) {
    console.error('Call logs query error:', err.message);
  }

  await client.end();
}

main().catch(console.error);
