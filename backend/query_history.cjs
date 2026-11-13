const fs = require('fs');
const token = fs.readFileSync('valid_token.txt', 'utf8').trim();
const BASE = 'https://caretrack-backend-kv2n.onrender.com';

async function main() {
  const childrenRes = await fetch(BASE + '/api/children', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const childrenData = await childrenRes.json();
  const allChildren = childrenData.children || [];
  const filterArg = process.argv[2]?.trim().toLowerCase();
  const children = filterArg
    ? allChildren.filter(c => c.name?.toLowerCase().includes(filterArg) || c.id?.toLowerCase().includes(filterArg))
    : allChildren;

  console.log(`Matched ${children.length} / ${allChildren.length} children:`, children.map(c => ({ id: c.id, name: c.name, last_seen: c.last_seen })));

  for (const c of children) {
    console.log(`\n================== Child: ${c.name} (${c.id}) ==================`);
    const histRes = await fetch(BASE + '/api/location/history?childId=' + c.id + '&limit=500', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const histData = await histRes.json();
    console.log(`Total Points in History: ${histData.count}`);
    const pts = (histData.points || []).map((p, i) => ({
      i: i + 1,
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      acc: p.accuracy,
      spd: p.speed,
      rec: p.recorded_at
    }));
    console.log('\n--- FIRST 15 POINTS ---');
    console.table(pts.slice(0, 15));
    console.log('\n--- LATEST 25 POINTS ---');
    console.table(pts.slice(-25));
  }
}

main().catch(console.error);
