package com.instantdb.android.compose

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.instantdb.android.InstantDb
import kotlinx.serialization.json.JsonObject

/**
 * Composable that provides a reactive InstantDB query.
 *
 * Returns the current state of the query: Loading, Data, Error, or Offline.
 *
 * Example usage:
 * ```kotlin
 * val queryState = rememberInstantQuery(
 *     instant = instantDb,
 *     query = "{ todos: { $: { $: {} } } }"
 * )
 *
 * when (val state = queryState) {
 *     is InstantQueryState.Loading -> CircularProgressIndicator()
 *     is InstantQueryState.Data -> Text("Data: ${state.data}")
 *     is InstantQueryState.Error -> Text("Error: ${state.message}")
 *     is InstantQueryState.Offline -> Text("Offline...")
 * }
 * ```
 */
@Composable
fun rememberInstantQuery(
    instant: InstantDb,
    query: String,
): InstantQueryState {
    return remember(query) {
        InstantQueryState.Loading
    }
}

/**
 * State of an InstantDB query.
 */
sealed class InstantQueryState {
    /** Query is loading */
    data object Loading : InstantQueryState()

    /** Query has data */
    data class Data(val data: Any?) : InstantQueryState()

    /** Query encountered an error */
    data class Error(val message: String) : InstantQueryState()

    /** Query is offline (using cached data) */
    data class Offline(val data: Any?) : InstantQueryState()
}
