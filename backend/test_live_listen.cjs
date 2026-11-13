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

let chunkCount = 0;

socket.on('connect', () => {
  console.log('✅ Parent connected to socket:', socket.id);
  console.log('Emitting live_listen:start for child:', childId);
  socket.emit('live_listen:start', { childId });
});

socket.on('live_listen:status', (data) => {
  console.log('📡 live_listen:status received:', data);
});

socket.on('live_audio:chunk', (data) => {
  chunkCount++;
  console.log(`🔊 [Chunk #${chunkCount}] Received audio chunk (${data.chunkBase64.length} chars)`);
  if (chunkCount === 10) {
    console.log('✅ Successfully received 10 live audio chunks! Emitting live_listen:stop...');
    socket.emit('live_listen:stop', { childId });
    setTimeout(() => {
      console.log('Test finished successfully. Total chunks:', chunkCount);
      socket.disconnect();
      process.exit(0);
    }, 2000);
  }
});

socket.on('live_listen:error', (err) => {
  console.error('❌ live_listen:error:', err);
  socket.disconnect();
  process.exit(1);
});

setTimeout(() => {
  console.log('⏱️ Timeout after 20s. Received chunks:', chunkCount);
  socket.emit('live_listen:stop', { childId });
  socket.disconnect();
  process.exit(0);
}, 20000);
