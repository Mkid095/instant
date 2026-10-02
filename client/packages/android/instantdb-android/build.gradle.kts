plugins {
    id("com.android.library")
    kotlin("android")
    kotlin("plugin.serialization") version "2.0.21"
    id("app.cash.sqldelight") version "2.0.2"
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"
    `maven-publish`
}

group = "com.instantdb"
version = "0.8.0-phase10"

val publishGroupId: String = "com.instantdb"
val publishArtifactId: String = "instantdb-android"
val publishDescription: String = "Android SDK for InstantDB"

android {
    namespace = "com.instantdb.android"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    // SQLDelight configuration
    sqldelight {
        databases {
            create("InstantDbDatabase") {
                packageName = "com.instantdb.android.persistence.sqlite"
                srcDirs("src/main/sqldelight")
            }
        }
    }
}

dependencies {
    // AndroidX Core
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.6")
    implementation("androidx.activity:activity-compose:1.9.3")

    // Compose BOM
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.runtime:runtime-livedata")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    // SQLDelight Android SQLite driver
    implementation("app.cash.sqldelight:android-driver:2.0.2")
    implementation("app.cash.sqldelight:coroutines-extensions:2.0.2")

    // Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // OkHttp (for WebSocket/SSE transports)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")

    // Security - Android Keystore for credential storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // InstantDB Kotlin core module (built from sibling project)
    implementation(project(":instantdb-kotlin"))

    // Test
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.10.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}

val releaseAarFile = file("build/outputs/aar/instantdb-android-release.aar")

tasks.register<PublishToMavenLocal>("publishReleaseAar") {
    doFirst {
        if (!releaseAarFile.exists()) {
            throw GradleException("AAR not found at ${releaseAarFile.absolutePath}. Run assembleRelease first.")
        }
    }
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            artifactId = publishArtifactId
            groupId = publishGroupId
            version = project.version.toString()
            description = publishDescription

            artifact(releaseAarFile)

            pom {
                name.set(publishArtifactId)
                description.set(publishDescription)
                url.set("https://github.com/instantdb/instantdb")
                withXml {
                    val dependencies = asNode().appendNode("dependencies")
                    listOf("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0",
                           "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0",
                           "org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3",
                           "com.squareup.okhttp3:okhttp:4.12.0",
                           "com.squareup.okhttp3:okhttp-sse:4.12.0",
                           "app.cash.sqldelight:android-driver:2.0.2",
                           "androidx.security:security-crypto:1.1.0-alpha06").forEach { dep ->
                        val parts = dep.split(":")
                        val node = dependencies.appendNode("dependency")
                        node.appendNode("groupId", parts[0])
                        node.appendNode("artifactId", parts[1])
                        node.appendNode("version", parts[2])
                    }
                    // InstantDB Kotlin core
                    val core = dependencies.appendNode("dependency")
                    core.appendNode("groupId", "com.instantdb")
                    core.appendNode("artifactId", "instantdb-kotlin")
                    core.appendNode("version", project.version.toString())
                }
            }
        }
    }
}

