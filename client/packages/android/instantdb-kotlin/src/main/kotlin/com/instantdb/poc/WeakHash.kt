package com.instantdb.poc

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Weak hash for query objects. NOT cryptographic. Used to key
 * subscriptions and pending mutations by query shape.
 *
 * Mirror of client/packages/core/src/utils/weakHash.ts:
 *   - stableStringify sorts keys, omits undefined, treats null as null
 *   - cyrb53-style 64-bit hash producing two 32-bit halves concatenated
 *     as hex
 *
 * The JS implementation is the canonical reference; we reimplement it
 * here so client and server agree on the same hash for the same query.
 */
object WeakHash {
    fun hash(input: JsonElement?): String {
        val s = stableStringify(input)
        return cyrb53(s, 0xdeadbeef.toInt(), 0x41c6ce57.toInt())
    }

    private fun stableStringify(node: JsonElement?): String {
        if (node == null || node is JsonNull) return "null"
        return when (node) {
            is JsonPrimitive -> {
                if (node.isString) "\"${escape(node.content)}\""
                else node.content
            }
            is JsonArray -> {
                val parts = node.map { stableStringify(it) }
                "[" + parts.joinToString(",") + "]"
            }
            is JsonObject -> {
                // Sort keys for stability.
                val keys = node.keys.sorted()
                val parts = keys.map { key ->
                    val v = node[key] ?: return@map null  // skip null (treated as missing)
                    "\"${escape(key)}\":${stableStringify(v)}"
                }.filterNotNull()
                "{" + parts.joinToString(",") + "}"
            }
        }
    }

    private fun escape(s: String): String {
        val sb = StringBuilder(s.length + 2)
        for (c in s) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '' -> sb.append("\\f")
                else -> if (c.code < 0x20) {
                    sb.append("\\u").append("%04x".format(c.code))
                } else {
                    sb.append(c)
                }
            }
        }
        return sb.toString()
    }

    private fun cyrb53(s: String, seed1: Int, seed2: Int): String {
        var h1 = seed1 xor s.length
        var h2 = seed2 xor s.length
        for (i in s.indices) {
            val ch = s[i].code
            h1 = h1 xor ch
            h1 = (h1 shl 13) or (h1 ushr 19)
            h1 = (h1 * 5 + 0xe6546b64.toInt())
            h2 = h2 xor ch
            h2 = (h2 shl 17) or (h2 ushr 15)
            h2 = (h2 * 5 + 0x1b873593.toInt())
        }
        h1 = (h1 xor (h1 ushr 16)) * 0x85ebca6b.toInt()
        h1 = (h1 xor (h1 ushr 13)) * 0xc2b2ae35.toInt()
        h1 = h1 xor (h1 ushr 16)
        h2 = (h2 xor (h2 ushr 16)) * 0x85ebca6b.toInt()
        h2 = (h2 xor (h2 ushr 13)) * 0xc2b2ae35.toInt()
        h2 = h2 xor (h2 ushr 16)
        val out1 = (h2.toLong() and 0xffffffffL).toString(16).padStart(8, '0')
        val out2 = (h1.toLong() and 0xffffffffL).toString(16).padStart(8, '0')
        return out1 + out2
    }
}
