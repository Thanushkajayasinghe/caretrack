const { io } = require('socket.io-client');

console.log('Testing connection to Render socket...');
const socket = io('https://caretrack-backend-kv2n.onrender.com', {
  path: '/socket.io',
  auth: { clientType: 'child' }, // No token, expect auth error
  transports: ['websocket', 'polling'],
  timeout: 10000,
});

socket.on('connect', () => {
  console.log('Connected!');
  socket.disconnect();
  process.exit(0);
});

socket.on('connect_error', (err) => {
  console.log('Connect error (expected auth failure):', err.message);
  socket.disconnect();
  process.exit(0);
});
