import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { getSocketUrl, getSocketPath, getBaseUrl } from '../config/server';

let socket = null;
let isRefreshingSocket = false;

export async function connectSocket() {
  if (socket?.connected) return socket;

  const token = await AsyncStorage.getItem('accessToken');
  if (!token) return null;

  if (socket) {
    socket.auth = async (cb) => {
      const currentToken = await AsyncStorage.getItem('accessToken');
      cb({ token: currentToken, clientType: 'parent' });
    };
    bindSocketEvents(socket);
    socket.connect();
    return socket;
  }

  socket = io(getSocketUrl(), {
    path: getSocketPath(),
    auth: async (cb) => {
      const currentToken = await AsyncStorage.getItem('accessToken');
      cb({ token: currentToken, clientType: 'parent' });
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: Infinity,
  });

  bindSocketEvents(socket);

  socket.on('connect', () => console.log('✅ Parent socket connected'));
  socket.on('disconnect', (reason) => console.log('❌ Parent socket disconnected:', reason));
  socket.on('connect_error', async (err) => {
    console.warn('Socket connect_error:', err.message);

    if (err.message === 'Authentication failed' && !isRefreshingSocket) {
      isRefreshingSocket = true;
      try {
        const refreshToken = await AsyncStorage.getItem('refreshToken');
        const parentId = await AsyncStorage.getItem('parentId');
        if (refreshToken && parentId) {
          const { data } = await axios.post(`${getBaseUrl()}/auth/refresh`, {
            refreshToken,
            parentId,
          });
          if (data?.accessToken) {
            await AsyncStorage.setItem('accessToken', data.accessToken);
            console.log('✅ Socket refreshed access token, reconnecting...');
            socket.connect();
          }
        }
      } catch (refreshErr) {
        console.warn('Socket token refresh failed:', refreshErr.message);
      } finally {
        isRefreshingSocket = false;
      }
    }
  });

  return socket;
}

const eventListeners = {
  location_update: new Set(),
  child_status: new Set(),
  child_paired: new Set(),
  child_battery_low: new Set(),
};

function bindSocketEvents(s) {
  if (!s) return;
  s.off('location_update');
  s.off('child_status');
  s.off('child_paired');
  s.off('child_battery_low');

  s.on('location_update', (data) => {
    console.log('📍 Parent socket received location_update:', data);
    eventListeners.location_update.forEach((handler) => {
      try { handler(data); } catch (err) { console.error('location_update handler error:', err); }
    });
  });

  s.on('child_status', (data) => {
    console.log('📶 Parent socket received child_status:', data);
    eventListeners.child_status.forEach((handler) => {
      try { handler(data); } catch (err) { console.error('child_status handler error:', err); }
    });
  });

  s.on('child_paired', (data) => {
    console.log('🤝 Parent socket received child_paired:', data);
    eventListeners.child_paired.forEach((handler) => {
      try { handler(data); } catch (err) { console.error('child_paired handler error:', err); }
    });
  });

  s.on('child_battery_low', (data) => {
    console.log('⚠️ Parent socket received child_battery_low:', data);
    eventListeners.child_battery_low.forEach((handler) => {
      try { handler(data); } catch (err) { console.error('child_battery_low handler error:', err); }
    });
  });
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function onLocationUpdate(handler) {
  eventListeners.location_update.add(handler);
  if (!socket?.connected) connectSocket();
}

export function onChildStatus(handler) {
  eventListeners.child_status.add(handler);
  if (!socket?.connected) connectSocket();
}

export function onChildPaired(handler) {
  eventListeners.child_paired.add(handler);
  if (!socket?.connected) connectSocket();
}

export function onChildBatteryLow(handler) {
  eventListeners.child_battery_low.add(handler);
  if (!socket?.connected) connectSocket();
}

export function offLocationUpdate(handler) {
  eventListeners.location_update.delete(handler);
}

export function offChildStatus(handler) {
  eventListeners.child_status.delete(handler);
}

export function offChildPaired(handler) {
  eventListeners.child_paired.delete(handler);
}

export function offChildBatteryLow(handler) {
  eventListeners.child_battery_low.delete(handler);
}

export function isSocketConnected() {
  return Boolean(socket?.connected);
}


