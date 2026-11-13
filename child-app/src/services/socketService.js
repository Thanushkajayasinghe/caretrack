import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSocketUrl, getSocketPath } from '../config/server';

let socket = null;

export async function connectChildSocket() {
  if (socket?.connected) return socket;

  const deviceToken = await AsyncStorage.getItem('deviceToken');
  const deviceFingerprint = await AsyncStorage.getItem('deviceFingerprint');
  if (!deviceToken || !deviceFingerprint) return null;

  const socketUrl = getSocketUrl();
  console.log('Connecting socket to:', socketUrl);

  socket = io(socketUrl, {
    path: getSocketPath(),
    auth: { token: deviceToken, clientType: 'child', deviceFingerprint },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => console.log('✅ Child socket connected'));
  socket.on('disconnect', (r) => console.log('Child socket disconnected:', r));
  socket.on('connect_error', (e) => console.error('Child socket error:', e.message));

  return socket;
}

export function getSocket() {
  return socket;
}

export function emitLocationUpdate(point) {
  if (socket?.connected) {
    socket.emit('location_update', point);
  }
}

export function emitStatusHeartbeat(data) {
  if (socket?.connected) {
    socket.emit('status_heartbeat', data);
  }
}

export function disconnectChildSocket() {
  socket?.disconnect();
  socket = null;
}
