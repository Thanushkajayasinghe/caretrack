import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db = null;

export async function initOfflineDB() {
  db = await SQLite.openDatabase({ name: 'caretrack_offline.db', location: 'default' });

  await db.executeSql(`
    CREATE TABLE IF NOT EXISTS location_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      accuracy    REAL,
      speed       REAL,
      heading     REAL,
      altitude    REAL,
      battery_level INTEGER,
      is_charging INTEGER,
      recorded_at TEXT NOT NULL,
      synced      INTEGER DEFAULT 0
    )
  `);

  console.log('✅ Offline SQLite DB ready');
  return db;
}

export async function queueLocation(point) {
  if (!db) await initOfflineDB();
  await db.executeSql(
    `INSERT INTO location_queue
      (lat, lng, accuracy, speed, heading, altitude, battery_level, is_charging, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      point.lat,
      point.lng,
      point.accuracy ?? null,
      point.speed ?? null,
      point.heading ?? null,
      point.altitude ?? null,
      point.batteryLevel ?? null,
      point.isCharging ? 1 : 0,
      point.recordedAt,
    ],
  );
}

export async function getPendingPoints(limit = 200) {
  if (!db) return [];
  const [results] = await db.executeSql(
    `SELECT * FROM location_queue WHERE synced = 0 ORDER BY recorded_at ASC LIMIT ?`,
    [limit],
  );
  const rows = [];
  for (let i = 0; i < results.rows.length; i++) {
    rows.push(results.rows.item(i));
  }
  return rows;
}

export async function markSynced(ids) {
  if (!db || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.executeSql(
    `UPDATE location_queue SET synced = 1 WHERE id IN (${placeholders})`,
    ids,
  );
}

export async function clearSynced() {
  if (!db) return;
  await db.executeSql(`DELETE FROM location_queue WHERE synced = 1`);
}
