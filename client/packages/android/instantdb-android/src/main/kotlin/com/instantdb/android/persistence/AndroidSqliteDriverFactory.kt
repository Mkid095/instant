package com.instantdb.android.persistence

import android.content.Context
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.instantdb.android.persistence.sqlite.InstantDbDatabase

/**
 * Factory for creating Android SQLite driver backed by SQLDelight.
 *
 * Uses the Android SQLite driver which is the recommended driver for
 * Android applications using SQLDelight.
 */
object AndroidSqliteDriverFactory {

    /**
     * Create an Android SQLite driver for the InstantDB local store.
     *
     * @param context Android context (used for database path)
     * @param name Database name
     * @param useInMemory If true, use in-memory database (for testing)
     */
    fun create(context: Context, name: String = "instantdb.db", useInMemory: Boolean = false): SqlDriver {
        val schema = InstantDbDatabase.Schema

        return if (useInMemory) {
            AndroidSqliteDriver(
                schema = schema,
                context = context,
                name = null, // null = in-memory
            )
        } else {
            AndroidSqliteDriver(
                schema = schema,
                context = context,
                name = name,
            )
        }
    }
}
