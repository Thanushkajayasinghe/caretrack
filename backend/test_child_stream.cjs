const https = require('https');
const crypto = require('crypto');

// Let's test the live-stream endpoint directly
console.log('Testing live-stream endpoint...');
const req = https.request('https://caretrack-backend-kv2n.onrender.com/api/snapshots/live-stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/octet-stream',
    'Transfer-Encoding': 'chunked',
  }
}, (res) => {
  console.log('Status code:', res.statusCode);
  res.on('data', d => console.log('Data:', d.toString()));
  res.on('end', () => console.log('Response ended'));
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

// Write 1 chunk
req.write(Buffer.alloc(3200, 1));
setTimeout(() => {
  console.log('Ending request after 3s...');
  req.end();
}, 3000);
