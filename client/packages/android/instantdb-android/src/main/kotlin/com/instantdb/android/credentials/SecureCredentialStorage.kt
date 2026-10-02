package com.instantdb.android.credentials

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure credential storage using Android EncryptedSharedPreferences.
 *
 * Stores refresh tokens and auth tokens securely using the Android Keystore,
 * ensuring credentials are encrypted at rest and only accessible to this app.
 */
class SecureCredentialStorage(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val securePrefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        PREFS_NAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    /**
     * Save credentials securely.
     */
    fun save(refreshToken: String?, adminToken: String?) {
        securePrefs.edit().apply {
            if (refreshToken != null) {
                putString(KEY_REFRESH_TOKEN, refreshToken)
            } else {
                remove(KEY_REFRESH_TOKEN)
            }
            if (adminToken != null) {
                putString(KEY_ADMIN_TOKEN, adminToken)
            } else {
                remove(KEY_ADMIN_TOKEN)
            }
            apply()
        }
    }

    /**
     * Load stored credentials.
     */
    fun load(): StoredCredentials? {
        val refreshToken = securePrefs.getString(KEY_REFRESH_TOKEN, null)
        val adminToken = securePrefs.getString(KEY_ADMIN_TOKEN, null)
        return if (refreshToken != null || adminToken != null) {
            StoredCredentials(refreshToken, adminToken)
        } else {
            null
        }
    }

    /**
     * Clear all stored credentials (logout).
     */
    fun clear() {
        securePrefs.edit().clear().apply()
    }

    /**
     * Check if credentials exist.
     */
    fun hasCredentials(): Boolean {
        return securePrefs.contains(KEY_REFRESH_TOKEN) || securePrefs.contains(KEY_ADMIN_TOKEN)
    }

    companion object {
        private const val PREFS_NAME = "instantdb_secure_prefs"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_ADMIN_TOKEN = "admin_token"
    }
}

data class StoredCredentials(
    val refreshToken: String?,
    val adminToken: String?,
)
