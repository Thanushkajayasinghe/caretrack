package com.helloworld

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import org.json.JSONObject

class OfflineLocationDb private constructor(context: Context) :
    SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        private const val TAG = "OfflineLocationDb"
        private const val DATABASE_NAME = "caretrack_offline.db"
        private const val DATABASE_VERSION = 1

        private const val TABLE_NAME = "offline_locations"
        private const val COL_ID = "id"
        private const val COL_LAT = "lat"
        private const val COL_LNG = "lng"
        private const val COL_ACCURACY = "accuracy"
        private const val COL_SPEED = "speed"
        private const val COL_HEADING = "heading"
        private const val COL_ALTITUDE = "altitude"
        private const val COL_BATTERY = "battery_level"
        private const val COL_CHARGING = "is_charging"
        private const val COL_RECORDED_AT = "recorded_at"
        private const val COL_ACTIVITY = "activity_type"
        private const val COL_CREATED_AT = "created_at"

        // Maximum points to retain in offline storage (~1.5 MB storage cap, ~12-24 hours)
        private const val MAX_OFFLINE_POINTS = 10000

        @Volatile
        private var instance: OfflineLocationDb? = null

        fun getInstance(context: Context): OfflineLocationDb {
            return instance ?: synchronized(this) {
                instance ?: OfflineLocationDb(context.applicationContext).also { instance = it }
            }
        }
    }

    override fun onCreate(db: SQLiteDatabase) {
        val createTableSql = """
            CREATE TABLE IF NOT EXISTS $TABLE_NAME (
                $COL_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                $COL_LAT REAL NOT NULL,
                $COL_LNG REAL NOT NULL,
                $COL_ACCURACY REAL,
                $COL_SPEED REAL,
                $COL_HEADING REAL,
                $COL_ALTITUDE REAL,
                $COL_BATTERY INTEGER,
                $COL_CHARGING INTEGER,
                $COL_RECORDED_AT TEXT NOT NULL,
                $COL_ACTIVITY TEXT,
                $COL_CREATED_AT INTEGER NOT NULL
            )
        """.trimIndent()
        db.execSQL(createTableSql)
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_offline_recorded ON $TABLE_NAME ($COL_RECORDED_AT)")
        Log.i(TAG, "Offline locations table created")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_NAME")
        onCreate(db)
    }

    /**
     * Enqueue a point into the offline queue when network transmission fails.
     */
    @Synchronized
    fun enqueue(point: JSONObject): Boolean {
        return try {
            val db = writableDatabase
            val values = ContentValues().apply {
                put(COL_LAT, point.optDouble("lat"))
                put(COL_LNG, point.optDouble("lng"))
                if (point.has("accuracy") && !point.isNull("accuracy")) {
                    put(COL_ACCURACY, point.optDouble("accuracy"))
                }
                if (point.has("speed") && !point.isNull("speed")) {
                    put(COL_SPEED, point.optDouble("speed"))
                }
                if (point.has("heading") && !point.isNull("heading")) {
                    put(COL_HEADING, point.optDouble("heading"))
                }
                if (point.has("altitude") && !point.isNull("altitude")) {
                    put(COL_ALTITUDE, point.optDouble("altitude"))
                }
                if (point.has("batteryLevel") && !point.isNull("batteryLevel")) {
                    put(COL_BATTERY, point.optInt("batteryLevel"))
                }
                if (point.has("isCharging") && !point.isNull("isCharging")) {
                    put(COL_CHARGING, if (point.optBoolean("isCharging")) 1 else 0)
                }
                put(COL_RECORDED_AT, point.optString("recordedAt", ""))
                put(COL_ACTIVITY, point.optString("activityType", "unknown"))
                put(COL_CREATED_AT, System.currentTimeMillis())
            }

            val insertedId = db.insert(TABLE_NAME, null, values)
            if (insertedId > 0) {
                enforceCapacity(db)
                Log.d(TAG, "Enqueued offline location successfully (id=$insertedId)")
                true
            } else {
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to enqueue offline location: ${e.message}")
            false
        }
    }

    /**
     * Peek up to [limit] oldest points from the queue without deleting them.
     */
    @Synchronized
    fun peekBatch(limit: Int = 100): List<Pair<Long, JSONObject>> {
        val result = mutableListOf<Pair<Long, JSONObject>>()
        val db = readableDatabase
        val cursor = db.query(
            TABLE_NAME,
            null,
            null,
            null,
            null,
            null,
            "$COL_ID ASC",
            limit.toString()
        )

        cursor.use { c ->
            val idIdx = c.getColumnIndexOrThrow(COL_ID)
            val latIdx = c.getColumnIndexOrThrow(COL_LAT)
            val lngIdx = c.getColumnIndexOrThrow(COL_LNG)
            val accIdx = c.getColumnIndexOrThrow(COL_ACCURACY)
            val spdIdx = c.getColumnIndexOrThrow(COL_SPEED)
            val hdgIdx = c.getColumnIndexOrThrow(COL_HEADING)
            val altIdx = c.getColumnIndexOrThrow(COL_ALTITUDE)
            val batIdx = c.getColumnIndexOrThrow(COL_BATTERY)
            val chgIdx = c.getColumnIndexOrThrow(COL_CHARGING)
            val recIdx = c.getColumnIndexOrThrow(COL_RECORDED_AT)
            val actIdx = c.getColumnIndexOrThrow(COL_ACTIVITY)

            while (c.moveToNext()) {
                val rowId = c.getLong(idIdx)
                val json = JSONObject().apply {
                    put("lat", c.getDouble(latIdx))
                    put("lng", c.getDouble(lngIdx))
                    if (!c.isNull(accIdx)) put("accuracy", c.getDouble(accIdx)) else put("accuracy", JSONObject.NULL)
                    if (!c.isNull(spdIdx)) put("speed", c.getDouble(spdIdx)) else put("speed", JSONObject.NULL)
                    if (!c.isNull(hdgIdx)) put("heading", c.getDouble(hdgIdx)) else put("heading", JSONObject.NULL)
                    if (!c.isNull(altIdx)) put("altitude", c.getDouble(altIdx)) else put("altitude", JSONObject.NULL)
                    if (!c.isNull(batIdx)) put("batteryLevel", c.getInt(batIdx)) else put("batteryLevel", JSONObject.NULL)
                    if (!c.isNull(chgIdx)) put("isCharging", c.getInt(chgIdx) == 1) else put("isCharging", JSONObject.NULL)
                    put("recordedAt", c.getString(recIdx))
                    put("activityType", c.getString(actIdx))
                }
                result.add(Pair(rowId, json))
            }
        }
        return result
    }

    /**
     * Delete points after successful upload confirmation by ID.
     */
    @Synchronized
    fun deleteBatch(ids: List<Long>): Int {
        if (ids.isEmpty()) return 0
        return try {
            val db = writableDatabase
            val idStr = ids.joinToString(",")
            db.delete(TABLE_NAME, "$COL_ID IN ($idStr)", null)
        } catch (e: Exception) {
            Log.e(TAG, "Error deleting offline batch: ${e.message}")
            0
        }
    }

    /**
     * Return total count of points pending in the offline queue.
     */
    @Synchronized
    fun getCount(): Long {
        return try {
            val db = readableDatabase
            val cursor = db.rawQuery("SELECT COUNT(*) FROM $TABLE_NAME", null)
            cursor.use {
                if (it.moveToFirst()) it.getLong(0) else 0L
            }
        } catch (e: Exception) {
            0L
        }
    }

    /**
     * Prune oldest points if storage exceeds [MAX_OFFLINE_POINTS] (circular FIFO).
     */
    private fun enforceCapacity(db: SQLiteDatabase) {
        try {
            val count = getCount()
            if (count > MAX_OFFLINE_POINTS) {
                val excess = count - MAX_OFFLINE_POINTS
                val sql = """
                    DELETE FROM $TABLE_NAME WHERE $COL_ID IN (
                        SELECT $COL_ID FROM $TABLE_NAME ORDER BY $COL_ID ASC LIMIT $excess
                    )
                """.trimIndent()
                db.execSQL(sql)
                Log.w(TAG, "Enforced FIFO capacity: deleted $excess oldest points")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Capacity enforcement error: ${e.message}")
        }
    }
}
