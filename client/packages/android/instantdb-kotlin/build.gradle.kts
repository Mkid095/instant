plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
    application
    id("app.cash.sqldelight") version "2.0.2"
    `maven-publish`
}

group = "com.instantdb"
version = "0.8.0-phase10"

// Publication metadata (Phase 4 preparation only; no actual publish performed).
// The publishing workflow lives in CI / Gradle Plugin Portal — see
// PHASE_4_REPORT.md §10 for the blocking items and the dry-run command.
val publishGroupId: String = "com.instantdb"
val publishArtifactId: String = "instantdb-kotlin"
val publishDescription: String = "Native Kotlin SDK for InstantDB — reusable client platform."
val publishLicense: String = "Apache-2.0"
val publishDeveloperName: String = "InstantDB"

repositories {
    mavenCentral()
    gradlePluginPortal()
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
    implementation("org.slf4j:slf4j-simple:2.0.16")

    // SQLDelight (Phase 4 persistence)
    implementation("app.cash.sqldelight:runtime:2.0.2")
    implementation("app.cash.sqldelight:coroutines-extensions:2.0.2")
    implementation("app.cash.sqldelight:sqlite-driver:2.0.2")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.11.3")
}

application {
    mainClass.set("com.instantdb.poc.MainKt")
}

tasks.test {
    useJUnitPlatform()
    systemProperty("instantdb.test.appId", System.getenv("INSTANT_TEST_APP_ID") ?: "")
    systemProperty("instantdb.test.adminToken", System.getenv("INSTANT_TEST_ADMIN_TOKEN") ?: "")
    systemProperty("instantdb.test.apiUri", System.getenv("INSTANT_TEST_API_URI") ?: "https://apiinstant.fidscript.com")
    systemProperty("instantdb.test.wsUri", System.getenv("INSTANT_TEST_WS_URI") ?: "wss://apiinstant.fidscript.com")
}

kotlin {
    jvmToolchain(21)
}

// SQLDelight database for Phase 4 persistence.
sqldelight {
    databases {
        create("InstantDbDatabase") {
            packageName = "com.instantdb.poc.persistence.sqlite"
            srcDirs(files("src/main/sqldelight"))
        }
    }
}

// Phase 5 — Maven publication configuration. No remote publish is
// performed; the user must provide credentials before any remote
// repository can be used.
tasks.register<Jar>("sourcesJar") {
    archiveClassifier.set("sources")
    from(sourceSets.main.get().allSource)
}

tasks.register<Jar>("javadocJar") {
    archiveClassifier.set("javadoc")
    from(sourceSets.main.get().allSource)
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            artifactId = publishArtifactId
            groupId = publishGroupId
            version = project.version.toString()
            description = publishDescription

            from(components["java"])
            artifact(tasks["sourcesJar"])
            artifact(tasks["javadocJar"])

            pom {
                name.set(publishArtifactId)
                description.set(publishDescription)
                url.set("https://github.com/instantdb/instantdb")
                licenses {
                    license {
                        name.set(publishLicense)
                        url.set("https://www.apache.org/licenses/LICENSE-2.0")
                    }
                }
                developers {
                    developer {
                        name.set(publishDeveloperName)
                        organization.set("InstantDB")
                        organizationUrl.set("https://www.instantdb.com")
                    }
                }
                scm {
                    url.set("https://github.com/instantdb/instantdb")
                    connection.set("scm:git:git://github.com/instantdb/instantdb.git")
                }
            }
        }
    }
}