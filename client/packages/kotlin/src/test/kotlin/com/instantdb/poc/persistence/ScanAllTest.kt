package com.instantdb.poc.persistence

import com.instantdb.poc.persistence.sqlite.BackedStores
import com.instantdb.poc.persistence.sqlite.SqliteBackingStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/**
 * Phase 7 — scanAll() SPI primitive + cold-start recovery without
 * prior knowledge of entity ids.
 */
class ScanAllTest {
    @TempDir lateinit var tempDir: Path
    private lateinit var backing: BackedStores

    @BeforeEach fun setUp() {
        backing = SqliteBackingStore.open(
            tempDir.resolve("scan.db").toString(),
            isMemory = false,
        )
    }

    @AfterEach fun tearDown() {
        backing.close()
    }

    @Test fun `scanAll returns every persisted triple`() = runBlocking {
        for (i in 0 until 50) {
            backing.tripleStore.write {
                put(Triple("e-$i", "aid", JsonPrimitive("v-$i"), i.toLong()))
            }
        }
        val scanned = backing.tripleStore.scanAll().toList()
        assertEquals(50, scanned.size)
        assertTrue(scanned.all { it.aid == "aid" })
    }

    @Test fun `scanAll is empty when database is empty`() = runBlocking {
        val scanned = backing.tripleStore.scanAll().toList()
        assertEquals(0, scanned.size)
    }

    @Test fun `scanAll across restart yields identical results`() = runBlocking {
        for (i in 0 until 20) {
            backing.tripleStore.write {
                put(Triple("e-$i", "aid", JsonPrimitive("v-$i"), i.toLong()))
            }
        }
        backing.close()

        // Reopen.
        backing = SqliteBackingStore.open(
            tempDir.resolve("scan.db").toString(),
            isMemory = false,
        )
        val scanned = backing.tripleStore.scanAll().toList()
        assertEquals(20, scanned.size)
        // Sorted by eid; first and last should match.
        assertEquals("e-0", scanned.first().eid)
        assertEquals("e-19", scanned.last().eid)
    }

    @Test fun `scanAll survives multiple restarts`() = runBlocking {
        // Round 1.
        backing.tripleStore.write {
            put(Triple("e1", "aid", JsonPrimitive("v1"), 1L))
        }
        backing.close()

        // Round 2.
        backing = SqliteBackingStore.open(tempDir.resolve("scan.db").toString(), isMemory = false)
        backing.tripleStore.write {
            put(Triple("e2", "aid", JsonPrimitive("v2"), 2L))
        }
        backing.close()

        // Round 3.
        backing = SqliteBackingStore.open(tempDir.resolve("scan.db").toString(), isMemory = false)
        val all = backing.tripleStore.scanAll().toList()
        assertEquals(2, all.size)
        assertTrue(all.any { it.eid == "e1" })
        assertTrue(all.any { it.eid == "e2" })
    }
}