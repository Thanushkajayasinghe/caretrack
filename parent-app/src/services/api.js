import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBaseUrl, initServerConfig } from '../config/server';

initServerConfig();

export const api = axios.create({
  baseURL: getBaseUrl(),
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: attach access token ──────────────────────────────────
api.interceptors.request.use(async (config) => {
  config.baseURL = getBaseUrl();
  const token = await AsyncStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response interceptor: auto-refresh on 401 & auto-retry on network drop ───
let isRefreshing = false;
let failedQueue = [];
const MAX_NETWORK_RETRIES = 2;

function processQueue(error, token = null) {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (!originalRequest) return Promise.reject(error);

    // Auto-retry transient network errors (packet drops, mobile data switches, timeouts)
    const isNetworkError =
      !error.response ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ERR_NETWORK' ||
      (error.message && error.message.toLowerCase().includes('network')) ||
      (error.message && error.message.toLowerCase().includes('timeout'));

    originalRequest._networkRetryCount = originalRequest._networkRetryCount || 0;
    if (isNetworkError && originalRequest._networkRetryCount < MAX_NETWORK_RETRIES) {
      originalRequest._networkRetryCount += 1;
      const delayMs = originalRequest._networkRetryCount * 1000;
      await new Promise((res) => setTimeout(res, delayMs));
      return api(originalRequest);
    }

    const isAuthRoute =
      originalRequest?.url?.includes('/auth/login') ||
      originalRequest?.url?.includes('/auth/register') ||
      originalRequest?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && !originalRequest?._retry && !isAuthRoute) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await AsyncStorage.getItem('refreshToken');
        const parentId = await AsyncStorage.getItem('parentId');
        if (!refreshToken || !parentId) throw new Error('No refresh token');

        const { data } = await axios.post(
          `${getBaseUrl()}/auth/refresh`,
          { refreshToken, parentId },
          { timeout: 45000 },
        );

        await AsyncStorage.setItem('accessToken', data.accessToken);
        if (data.refreshToken) {
          await AsyncStorage.setItem('refreshToken', data.refreshToken);
        }

        api.defaults.headers.common.Authorization = `Bearer ${data.accessToken}`;
        processQueue(null, data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);

        // Only wipe credentials if the server explicitly confirmed the token or account is invalid
        // NEVER wipe on network timeouts, offline drops, or server cold-starts (502/503)
        const isDefiniteAuthFailure =
          refreshError.response &&
          (refreshError.response.status === 401 || refreshError.response.status === 403) &&
          (typeof refreshError.response.data?.error === 'string' &&
            (refreshError.response.data.error.toLowerCase().includes('token') ||
             refreshError.response.data.error.toLowerCase().includes('parent')));

        if (isDefiniteAuthFailure) {
          console.warn('[API] Refresh token rejected by server. Clearing credentials.');
          await AsyncStorage.multiRemove(['accessToken', 'refreshToken', 'parentId']);
        } else {
          console.warn('[API] Token refresh delayed by network or server wake-up. Preserving login session.');
        }

        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// ── API helpers ───────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  googleAuth: (data) => api.post('/auth/google', data),
  updateProfile: (data) => api.put('/auth/profile', data),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me'),
};

export const childAPI = {
  list: () => api.get('/children'),
  create: (data) => api.post('/children', data),
  get: (id) => api.get(`/children/${id}`),
  delete: (id) => api.delete(`/children/${id}`),
  updateSettings: (id, data) => api.put(`/children/${id}/settings`, data),
  updateAvatar: (id, avatarUrl) => api.put(`/children/${id}/avatar`, { avatarUrl }),
  updateTamperPin: (id, pin) => api.post(`/children/${id}/tamper-pin`, { pin }),
};

export const pairAPI = {
  generate: (data) => api.post('/pair/generate', data),
  status: (sessionId) => api.get(`/pair/status/${sessionId}`),
};

export const locationAPI = {
  live: (childId) => api.get(`/location/live/${childId}`),
  history: (params) => api.get('/location/history', { params }),
  trips: (params) => api.get('/location/trips', { params }),
};

export const snapshotAPI = {
  request: (data) => api.post('/snapshots/request', data),
  saveLive: (data) => api.post('/snapshots/save-live', data),
  list: (childId, params) => api.get(`/snapshots/child/${childId}`, { params }),
  markViewed: (id) => api.patch(`/snapshots/${id}/viewed`),
  delete: (id) => api.delete(`/snapshots/${id}`),
};

export const callAPI = {
  list: (childId, params) => api.get(`/calls/child/${childId}`, { params }),
  requestSync: (childId) => api.post('/calls/request-sync', { childId }),
  delete: (id) => api.delete(`/calls/${id}`),
};


