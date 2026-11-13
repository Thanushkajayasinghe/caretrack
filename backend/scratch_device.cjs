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
  const d = await client.query('SELECT * FROM child_devices WHERE child_id = $1', ['b97b40d8-afec-47aa-a529-b31f96954188']);
  console.log('Device in DB:', d.rows[0]);
  await client.end();
}
main().catch(console.error);
