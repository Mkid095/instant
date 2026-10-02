// Top-level Gradle build for instantdb-android
// InstantDB Android SDK - composable, multi-transport InstantDB client

plugins {
    kotlin("jvm") version "2.0.21" apply false
    kotlin("plugin.serialization") version "2.0.21" apply false
    id("app.cash.sqldelight") version "2.0.2" apply false
    id("com.android.library") version "8.5.2" apply false
}
