import fs from 'fs';

const BASE = 'https://caretrack-backend-kv2n.onrender.com';

async function main() {
  console.log("Logging in to Render backend...");
  let token = '';
  
  // Try login
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'thanushkajayasinghe@gmail.com',
      password: 'secret123'
    })
  });
  
  if (loginRes.ok) {
    const loginData = await loginRes.json();
    token = loginData.accessToken;
    console.log("Login successful! Token acquired.");
  } else {
    console.log("Login failed status:", loginRes.status, await loginRes.text());
    // Try reading valid_token.txt or refresh token
    const refreshToken = fs.readFileSync('valid_refresh_token.txt', 'utf8').trim();
    const refRes = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken,
        parentId: 'abb90b9f-5213-4378-97a2-2ef4924b5898'
      })
    });
    if (refRes.ok) {
      const refData = await refRes.json();
      token = refData.accessToken;
      console.log("Refresh successful! Token acquired.");
    } else {
      console.log("Refresh failed status:", refRes.status, await refRes.text());
    }
  }

  if (!token) {
    console.error("Could not obtain access token!");
    return;
  }

  // Get children
  const childrenRes = await fetch(`${BASE}/api/children`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const childrenData = await childrenRes.json();
  console.log("Children data:", childrenData);

  const children = childrenData.children || [];
  for (const child of children) {
    console.log(`\n================== Child: ${child.name} (${child.id}) ==================`);
    console.log(`Status: ${child.status}, Battery: ${child.battery_level}%, Last seen: ${child.last_seen}`);
    
    const histRes = await fetch(`${BASE}/api/location/history?childId=${child.id}&limit=100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const histData = await histRes.json();
    console.log(`Total Points returned: ${histData.points?.length || 0}`);
    
    if (histData.points && histData.points.length > 0) {
      console.log("\nRecent 40 location points (newest first):");
      for (const p of histData.points.slice(0, 40)) {
        const time = new Date(p.recorded_at || p.created_at).toLocaleTimeString();
        const fullTime = p.recorded_at || p.created_at;
        console.log(`[${time} | ${fullTime}] Act: ${String(p.activity_type || p.activityType || 'N/A').padEnd(12)} | Spd: ${(p.speed ?? 0).toFixed(2)} m/s (${((p.speed ?? 0)*3.6).toFixed(1)} km/h) | Acc: ${(p.accuracy ?? 0).toFixed(1)}m | Lat: ${p.lat}, Lng: ${p.lng}`);
      }
    }
  }
}

main().catch(console.error);
