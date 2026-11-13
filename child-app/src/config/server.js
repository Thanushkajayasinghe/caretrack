import AsyncStorage from '@react-native-async-storage/async-storage';

// Default server configuration
export const DEFAULT_SERVER_URL = 'http://123.231.114.160:5000/caretrack';

export const STORAGE_KEY_SERVER_URL = 'custom_server_url';
export const STORAGE_KEY_SERVER_HOST = 'custom_server_host';
export const STORAGE_KEY_SERVER_PORT = 'custom_server_port';

export function parseServerUrl(rawInput) {
  let str = (rawInput || '').trim();
  if (!str) str = DEFAULT_SERVER_URL;

  // Clean any multiple/nested http/https/ttp prefixes if accidentally pasted or corrupted
  const hasHttps = /^https:\/\//i.test(str);
  str = str.replace(/^(https?:\/\/|ttp:\/\/)+/gi, '');

  const protocol = hasHttps ? 'https' : 'http';
  str = `${protocol}://${str}`.replace(/\/+$/, '');

  try {
    const url = new URL(str);
    const host = url.hostname;
    const port = url.port ? parseInt(url.port, 10) : (protocol === 'https' ? 443 : 80);
    const path = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : '';
    const fullBaseUrl = `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${path}`;
    const socketUrl = `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
    const socketPath = path ? `${path}/socket.io` : '/socket.io';
    return { fullBaseUrl, socketUrl, socketPath, protocol: url.protocol.replace(':', ''), host, port, path };
  } catch (_e) {
    return {
      fullBaseUrl: str,
      socketUrl: str,
      socketPath: '/socket.io',
      protocol,
      host: str.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0],
      port: 5000,
      path: '',
    };
  }
}

let cachedConfig = parseServerUrl(DEFAULT_SERVER_URL);

/**
 * Initialize cached server config from AsyncStorage
 */
export async function initServerConfig() {
  try {
    const savedUrl = await AsyncStorage.getItem(STORAGE_KEY_SERVER_URL);
    // Ignore corrupted strings (like "http://http://ttp://...")
    if (savedUrl && !savedUrl.includes('ttp://') && (savedUrl.match(/http/gi) || []).length <= 1) {
      cachedConfig = parseServerUrl(savedUrl);
    } else {
      if (savedUrl) await AsyncStorage.removeItem(STORAGE_KEY_SERVER_URL);
      cachedConfig = parseServerUrl(DEFAULT_SERVER_URL);
    }
  } catch (_e) {
    cachedConfig = parseServerUrl(DEFAULT_SERVER_URL);
  }
  return cachedConfig;
}

/**
 * Save custom server URL
 */
export async function setServerConfig(url) {
  cachedConfig = parseServerUrl(url);
  await AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, cachedConfig.fullBaseUrl);
  return cachedConfig;
}

/**
 * Get current server config object
 */
export function getServerConfig() {
  return cachedConfig;
}

export function getServerUrl() {
  return cachedConfig.fullBaseUrl;
}

/**
 * Get dynamic Base API URL (e.g. http://123.231.114.160:5000/caretrack/api)
 */
export function getBaseUrl() {
  return `${cachedConfig.fullBaseUrl}/api`;
}

/**
 * Get dynamic Socket.IO URL
 */
export function getSocketUrl() {
  return cachedConfig.socketUrl;
}

export function getSocketPath() {
  return cachedConfig.socketPath;
}

// Initialize cached config on module load
initServerConfig();
