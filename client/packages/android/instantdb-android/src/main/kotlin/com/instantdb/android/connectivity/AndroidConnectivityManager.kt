package com.instantdb.android.connectivity

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Android connectivity monitoring using ConnectivityManager and NetworkCallback.
 *
 * Provides a reactive Flow of connectivity states and methods to check
 * current connectivity status.
 */
class AndroidConnectivityManager(private val context: Context) {
    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var currentState: NetworkState = NetworkState.Unknown

    /**
     * Observe network connectivity changes as a Flow.
     */
    fun observe(): Flow<NetworkState> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(NetworkState.Available)
                currentState = NetworkState.Available
            }

            override fun onLost(network: Network) {
                trySend(NetworkState.Lost)
                currentState = NetworkState.Lost
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities
            ) {
                val state = if (networkCapabilities.hasCapability(
                        NetworkCapabilities.NET_CAPABILITY_INTERNET
                    )
                ) {
                    NetworkState.Available
                } else {
                    NetworkState.Lost
                }
                trySend(state)
                currentState = state
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(request, callback)
        networkCallback = callback

        // Emit initial state
        trySend(getCurrentState())

        awaitClose {
            connectivityManager.unregisterNetworkCallback(callback)
            networkCallback = null
        }
    }.distinctUntilChanged()

    /**
     * Check if currently online.
     */
    fun isOnline(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /**
     * Get current connectivity state.
     */
    fun getCurrentState(): NetworkState {
        val network = connectivityManager.activeNetwork
        if (network == null) {
            return NetworkState.Lost
        }
        val capabilities = connectivityManager.getNetworkCapabilities(network)
        if (capabilities == null) {
            return NetworkState.Unknown
        }
        return if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            NetworkState.Available
        } else {
            NetworkState.Lost
        }
    }

    /**
     * Stop monitoring connectivity.
     */
    fun stop() {
        networkCallback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
            } catch (_: Exception) {
                // Already unregistered
            }
            networkCallback = null
        }
    }
}

/**
 * Network connectivity state.
 */
sealed class NetworkState {
    /** Network is available and connected */
    data object Available : NetworkState()

    /** Network is lost/disconnected */
    data object Lost : NetworkState()

    /** Network state is unknown */
    data object Unknown : NetworkState()
}
