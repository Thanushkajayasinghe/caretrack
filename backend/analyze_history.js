import fs from 'fs';

const BASE = 'https://caretrack-backend-kv2n.onrender.com';
const token = fs.readFileSync('valid_token.txt', 'utf8').trim();

async function main() {
  const childId = '6c90aebf-733d-4b02-b733-4e8a8ab6ce6b';
  const res = await fetch(`${BASE}/api/location/history?childId=${childId}&limit=100`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  const points = data.points || [];

  console.log(`Analyzing ${points.length} history points for child ${childId}:\n`);

  let prev = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const time = new Date(p.recorded_at).toLocaleTimeString('en-US', { timeZone: 'Asia/Colombo', hour12: true });
    const spdKmh = ((p.speed ?? 0) * 3.6).toFixed(1);
    const acc = (p.accuracy ?? 0).toFixed(1);
    
    let dt = 0;
    let dist = 0;
    if (prev) {
      dt = (new Date(p.recorded_at) - new Date(prev.recorded_at)) / 1000;
      // Haversine
      const R = 6371000;
      const dLat = (p.lat - prev.lat) * Math.PI / 180;
      const dLon = (p.lng - prev.lng) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(prev.lat*Math.PI/180) * Math.cos(p.lat*Math.PI/180) * Math.sin(dLon/2)**2;
      dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }
    
    const impliedKmh = dt > 0 ? ((dist / dt) * 3.6).toFixed(1) : '0.0';
    console.log(`[#${i+1}] ${time} | Spd: ${spdKmh.padStart(5)} km/h | Acc: ${acc.padStart(4)}m | dt: ${dt.toFixed(1).padStart(5)}s | dist: ${dist.toFixed(1).padStart(5)}m | implied: ${impliedKmh.padStart(5)} km/h | Lat: ${p.lat.toFixed(5)}, Lng: ${p.lng.toFixed(5)}`);
    prev = p;
  }
}

main().catch(console.error);
