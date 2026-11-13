const { io } = require('socket.io-client');
const fs = require('fs');

const parentToken = fs.readFileSync('d:/Projects/CareTrack/backend/valid_token.txt', 'utf8').trim();
const childId = 'b97b40d8-afec-47aa-a529-b31f96954188';

console.log('Connecting as parent...');
const socket = io('https://caretrack-backend-kv2n.onrender.com', {
  path: '/socket.io',
  auth: { token: parentToken, clientType: 'parent' },
  transports: ['websocket', 'polling'],
  timeout: 10000,
});

socket.on('connect', () => {
  console.log('✅ Parent connected to socket:', socket.id);
  console.log('Emitting snapshot:request for child:', childId);
  socket.emit('snapshot:request', {
    childId,
    mediaType: 'audio',
    options: { durationSeconds: 20 },
    requestId: `test_${Date.now()}`
  });
});

socket.on('snapshot:error', (err) => {
  console.error('❌ Server returned snapshot:error:', err);
  socket.disconnect();
  process.exit(1);
});

socket.on('snapshot:ready', (data) => {
  console.log('🎉 Received snapshot:ready!', data);
  socket.disconnect();
  process.exit(0);
});

setTimeout(() => {
  console.log('Test completed 35s wait. Disconnecting.');
  socket.disconnect();
  process.exit(0);
}, 35000);
