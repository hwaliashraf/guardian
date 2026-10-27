package com.guardian.vpn

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Downloads + merges the three free curated open blocklists (LEDGER.md decision: StevenBlack +
 * OISD + HaGeZi — merged, not a paid commercial feed) into a single domain -> category map,
 * persisted to a flat newline-delimited file.
 *
 * **Persistence choice: flat file, not Room** (ticket's explicit "pick one, document choice"
 * ask). Room needs an annotation-processor (KSP/kapt) Gradle setup this ticket can't verify
 * compiles (no JVM in this build environment — see SETUP.md); a flat file needs zero new Gradle
 * plugins/dependencies and is trivially correct for a simple domain->category lookup table with
 * no relational structure. Format: one `domain,category` pair per line (category is one of T15's
 * `packages/domain/src/contentCategories.ts` `CONTENT_CATEGORIES` ids).
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment.
 */
object BlocklistLoader {

    // Canonical raw list URLs, cited per source project (spec §4 / LEDGER's blocklist-sourcing
    // decision). A real deployment should periodically re-check these for upstream URL changes.
    /** StevenBlack/hosts — merged adware+malware+porn+gambling host list.
     * https://github.com/StevenBlack/hosts */
    private const val STEVENBLACK_URL =
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn/hosts"
    /** OISD "big" blocklist (domain-format mirror) — https://oisd.nl */
    private const val OISD_URL = "https://big.oisd.nl/domainswild2"
    /** HaGeZi "Pro" DNS blocklist — https://github.com/hagezi/dns-blocklists */
    private const val HAGEZI_URL = "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/pro.txt"

    private const val BLOCKLIST_FILE_NAME = "guardian_blocklist.txt"
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 15_000

    private fun blocklistFile(context: Context): File = File(context.filesDir, BLOCKLIST_FILE_NAME)

    /** Fetches one list's raw text body over HTTPS. Returns null on any network/HTTP failure so a
     * single source outage doesn't abort the whole refresh (best-effort merge of whichever
     * sources succeeded this run — the previous file on disk is left untouched until a refresh
     * actually produces a non-empty merge, see `refresh`). */
    private fun fetchList(url: String): String? {
        return try {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.requestMethod = "GET"
            connection.inputStream.bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            null
        }
    }

    /** Hosts-file format (StevenBlack): "0.0.0.0 domain.tld" or "127.0.0.1 domain.tld" per line;
     * comments start with '#'. Extracts just the domain. */
    private fun parseHostsFormat(body: String, category: String, into: MutableMap<String, String>) {
        for (rawLine in body.lineSequence()) {
            val line = rawLine.trim()
            if (line.isEmpty() || line.startsWith("#")) continue
            val parts = line.split(Regex("\\s+"))
            if (parts.size < 2) continue
            val domain = parts[1].trim().lowercase()
            if (domain.isEmpty() || domain == "localhost") continue
            into.putIfAbsent(domain, category)
        }
    }

    /** Plain domain-per-line format (OISD domain mirror, HaGeZi) — comments start with '#'/'!';
     * some lists use adblock-style "||domain^" wildcard syntax, stripped here. */
    private fun parsePlainDomainFormat(body: String, category: String, into: MutableMap<String, String>) {
        for (rawLine in body.lineSequence()) {
            val line = rawLine.trim()
            if (line.isEmpty() || line.startsWith("#") || line.startsWith("!")) continue
            val domain = line.removePrefix("||").removeSuffix("^").trim().lowercase()
            if (domain.isEmpty()) continue
            into.putIfAbsent(domain, category)
        }
    }

    /**
     * Downloads all three sources and merges into one domain->category map, then persists to the
     * flat file (replacing any previous contents — only when at least one source succeeded;
     * returns 0 and leaves the existing file untouched if all three fail).
     *
     * **Category-to-spec mapping** (ticket's explicit minimum): StevenBlack -> `advertisements`
     * (it's primarily a curated ad/malware/porn host list — porn entries are also legitimately
     * `adult`, but this pass tags the whole source list with one category for simplicity, per
     * the ticket's "at minimum" ask); OISD's "big" list -> `adult_ad_networks` (a broad
     * ads+adult+malware aggregate); HaGeZi "Pro" -> `trackers` (that list's explicit focus is
     * tracking/analytics/telemetry domains). First-seen source wins on overlap (`putIfAbsent`,
     * StevenBlack checked first as the most conservative/well-established of the three) — a
     * domain is never tagged with two categories.
     */
    fun refresh(context: Context): Int {
        val merged = mutableMapOf<String, String>()

        fetchList(STEVENBLACK_URL)?.let { parseHostsFormat(it, "advertisements", merged) }
        fetchList(OISD_URL)?.let { parsePlainDomainFormat(it, "adult_ad_networks", merged) }
        fetchList(HAGEZI_URL)?.let { parsePlainDomainFormat(it, "trackers", merged) }

        if (merged.isEmpty()) return 0

        val file = blocklistFile(context)
        file.bufferedWriter().use { writer ->
            for ((domain, category) in merged) {
                writer.write(domain)
                writer.write(",")
                writer.write(category)
                writer.newLine()
            }
        }
        return merged.size
    }

    /** Loads the persisted flat file into memory (empty map if a refresh has never succeeded
     * yet). Called on `GuardianVpnService` start so filtering works immediately from the
     * last-known-good list, without waiting on a fresh download (offline-first, spec §7). */
    fun load(context: Context): Map<String, String> {
        val file = blocklistFile(context)
        if (!file.exists()) return emptyMap()
        val result = mutableMapOf<String, String>()
        file.forEachLine { line ->
            val idx = line.lastIndexOf(',')
            if (idx > 0 && idx < line.length - 1) {
                result[line.substring(0, idx)] = line.substring(idx + 1)
            }
        }
        return result
    }
}
