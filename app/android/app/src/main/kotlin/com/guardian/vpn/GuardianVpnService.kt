package com.guardian.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramSocket
import kotlin.concurrent.thread

/**
 * Layer 1 (spec §4): local `VpnService`-based DNS filter. Establishes a TUN interface, intercepts
 * outgoing UDP/53 DNS queries, resolves each one's action via `DnsDecision` (the Kotlin mirror of
 * `packages/domain/src/vpn/dnsDecision.ts` — see that object's header comment), and either
 * forwards the query untouched, forwards a rewritten query (SafeSearch/YouTube-restricted
 * enforcement), or synthesizes an NXDOMAIN response locally (blocked).
 *
 * UNVERIFIED: this file cannot be compiled or run in this build environment (no JVM/Gradle — see
 * SETUP.md's "Java / Android SDK" section). Written as complete, real Kotlin, not a stub.
 *
 * **Scope note / KNOWN REAL LIMITATION (stated plainly, not hidden — this is the one place this
 * ticket's own "state this plainly" instruction matters most)**: the VPN routes ALL device
 * traffic through the TUN (`addRoute("0.0.0.0", 0)` below), which is required so
 * `BypassPrevention`'s DoH(443)/DoT(853)-resolver-IP blocklist (Requirement 3) can actually see
 * and drop those connections at the TUN layer — checked for BOTH protocols (DoH increasingly
 * runs over UDP too, via QUIC/HTTP-3, not just TCP) before anything else happens to that packet.
 * UDP traffic that isn't a DNS query (port 53) and isn't a blocklisted DoH/DoT destination is
 * given a best-effort passthrough (`passthroughUdp` — a real protected-socket relay, not a stub,
 * but a simplified one-round-trip-per-packet model, not a persistent NAT session — see that
 * function's own doc comment for the tradeoff). **TCP traffic is NOT passed through at all in
 * this pass — every TCP connection (i.e. essentially all real HTTPS/web/app traffic) is
 * currently dropped while this service is active**, because a correct general TCP passthrough
 * needs a real user-space NAT/TCP-proxy subsystem (sequence/ack rewriting, connection state,
 * retransmission — comparable in scope to a small independent project like `tun2socks`), which
 * is disproportionate to build un-verifiably in one ticket. A human continuing this ticket's work
 * must resolve this before shipping: either (a) build a real TCP relay, or (b) switch to a
 * DNS-only routing model (route only the TUN's own DNS-server address, not 0.0.0.0/0, so
 * non-DNS traffic never enters the TUN and doesn't need passthrough at all) and find a different
 * mechanism for Requirement 3's DoH/DoT interception (e.g. a periodic connectivity-check
 * heuristic instead of TUN-layer packet inspection). See LEDGER.md's T22 entry and SETUP.md.
 */
class GuardianVpnService : VpnService() {

    private var tunInterface: ParcelFileDescriptor? = null
    @Volatile private var running = false
    private var workerThread: Thread? = null
    private var bypassCheckThread: Thread? = null
    // Set by `onRevoke()` so `onDestroy()` (which Android calls shortly after any revoke, via its
    // default `onRevoke()`'s own `stopSelf()`) doesn't ALSO report a second tamper event for the
    // same revoke — reviewer-caught double-emission bug, fixed here.
    @Volatile private var revokedByUser = false

    // Cached in-memory snapshots — refreshed by `updateBlocklist`/`updatePolicy`, called by
    // `VpnModule` whenever a fresh local copy is available (offline-first, spec §7: this service
    // never blocks on a network round-trip to make a per-query decision).
    @Volatile private var blocklist: Map<String, String> = emptyMap()
    @Volatile private var policy: ContentFilterPolicyView = ContentFilterPolicyView(
        categories = emptyMap(),
        whitelistOnly = false,
        customAllowDomains = emptyList(),
        customBlockDomains = emptyList(),
        customBlockKeywords = emptyList(),
        safeSearchEnforced = false,
        youtubeRestrictedMode = false,
    )

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running) return START_STICKY
        startForeground(NOTIFICATION_ID, buildForegroundNotification())
        establishTun()
        running = true
        isRunning = true
        // Blocklist load reads a flat file (I/O) — do it on the worker thread, not this method's
        // caller (Android's main thread), before the packet loop starts using it.
        workerThread = thread(name = "GuardianVpnPacketLoop") {
            blocklist = BlocklistLoader.load(applicationContext)
            runPacketLoop()
        }
        bypassCheckThread = thread(name = "GuardianBypassCheck") { runBypassCheckLoop() }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        isRunning = false
        workerThread?.interrupt()
        bypassCheckThread?.interrupt()
        tunInterface?.close()
        tunInterface = null
        val wasExpected = expectedStop || revokedByUser
        expectedStop = false
        revokedByUser = false
        if (!wasExpected) BypassPrevention.onVpnStopped(applicationContext)
        super.onDestroy()
    }

    override fun onRevoke() {
        // The user revoked VPN permission from system settings — never a parent-initiated stop,
        // always a tamper signal. Reports it here (not via `onDestroy`, which Android's default
        // `onRevoke()` -> `stopSelf()` triggers shortly after) and sets `revokedByUser` so
        // `onDestroy` recognizes this as already-reported and doesn't emit a second event for the
        // same revoke.
        revokedByUser = true
        BypassPrevention.onVpnStopped(applicationContext)
        super.onRevoke()
    }

    /** Called by `VpnModule` whenever a fresh `Policy.contentFilter` snapshot is available
     * locally (synced from T08, cached on-device). */
    fun updatePolicy(newPolicy: ContentFilterPolicyView) {
        policy = newPolicy
    }

    /** Called by `VpnModule` after `BlocklistLoader.refresh()` completes. */
    fun updateBlocklist(newBlocklist: Map<String, String>) {
        blocklist = newBlocklist
    }

    private fun establishTun() {
        val builder = Builder()
            .setSession("Guardian DNS Filter")
            .addAddress(TUN_ADDRESS, 32)
            .addDnsServer(TUN_ADDRESS)
            .addRoute("0.0.0.0", 0)
            .setMtu(TUN_MTU)
        tunInterface = builder.establish()
    }

    private fun runPacketLoop() {
        val fd = tunInterface?.fileDescriptor ?: return
        val input = FileInputStream(fd)
        val output = FileOutputStream(fd)
        val buffer = ByteArray(TUN_MTU)

        while (running) {
            val length = try {
                input.read(buffer)
            } catch (e: Exception) {
                if (running) continue else break
            }
            if (length <= 0) continue

            try {
                handlePacket(buffer, length, output)
            } catch (e: Exception) {
                // Malformed/unsupported packet — drop it silently rather than crashing the loop;
                // one bad packet must never take down DNS filtering for the whole device.
            }
        }
    }

    private fun readPort(packet: ByteArray, offset: Int): Int =
        ((packet[offset].toInt() and 0xFF) shl 8) or (packet[offset + 1].toInt() and 0xFF)

    private fun formatIpv4(packet: ByteArray, offset: Int): String =
        "%d.%d.%d.%d".format(
            java.util.Locale.US,
            packet[offset].toInt() and 0xFF,
            packet[offset + 1].toInt() and 0xFF,
            packet[offset + 2].toInt() and 0xFF,
            packet[offset + 3].toInt() and 0xFF,
        )

    private fun handlePacket(packet: ByteArray, length: Int, output: FileOutputStream) {
        val ipVersion = (packet[0].toInt() shr 4) and 0x0F
        if (ipVersion != 4) return // IPv6 passthrough not implemented in this pass — documented scope limit
        val ihl = (packet[0].toInt() and 0x0F) * 4
        val protocol = packet[9].toInt() and 0xFF
        val destIp = formatIpv4(packet, 16)

        if (protocol == PROTOCOL_TCP) {
            // See this file's header comment: TCP passthrough is NOT implemented, so every TCP
            // connection is dropped here regardless of destination. This explicit DoH/DoT-IP
            // check is kept anyway (not deleted as "redundant right now") so it remains the
            // permanent, enforced bypass-prevention rule the moment a human adds real TCP
            // passthrough — that future change must never turn into "just forward everything."
            val destPort = readPort(packet, ihl + 2)
            if ((destPort == DOH_PORT || destPort == DOT_PORT) && BypassPrevention.KNOWN_DOH_DOT_IPS.contains(destIp)) {
                return // explicit bypass-prevention drop (Requirement 3)
            }
            return // TCP passthrough not implemented — drops all other TCP too, see header comment
        }

        if (protocol != PROTOCOL_UDP) return // e.g. ICMP — not handled, dropped

        val udpStart = ihl
        val srcPort = readPort(packet, udpStart)
        val dstPort = readPort(packet, udpStart + 2)

        if (dstPort != DNS_PORT) {
            // Same explicit bypass-prevention rule as the TCP branch above (Requirement 3) — DoH
            // increasingly runs over UDP too (DoH-over-QUIC/HTTP-3 on port 443, same as DoT's
            // UDP variant), so this check must not be TCP-only or it silently misses that vector.
            if ((dstPort == DOH_PORT || dstPort == DOT_PORT) && BypassPrevention.KNOWN_DOH_DOT_IPS.contains(destIp)) {
                return
            }
            passthroughUdp(packet, ihl, udpStart, length, srcPort, destIp, dstPort, output)
            return
        }

        val dnsStart = udpStart + 8
        val queryDomain = DnsWireFormat.parseQuestionName(packet, dnsStart) ?: return

        val decision = DnsDecision.resolve(queryDomain, policy, blocklist)
        when (decision.action) {
            DnsActionKind.BLOCK -> {
                VpnModule.emitBlockAttempt(queryDomain, decision.category)
                val response = DnsWireFormat.buildNxDomainResponse(packet, dnsStart)
                output.write(DnsWireFormat.buildIpv4UdpPacket(packet, ihl, srcPort, DNS_PORT, response))
            }
            DnsActionKind.ALLOW -> {
                val upstreamQueryDomain = decision.rewriteTo ?: queryDomain
                val answerIps = queryUpstream(upstreamQueryDomain)
                if (answerIps.isEmpty()) return // upstream failure: drop, client's own retry/timeout handles it
                val response = DnsWireFormat.buildAnswerResponse(packet, dnsStart, answerIps)
                output.write(DnsWireFormat.buildIpv4UdpPacket(packet, ihl, srcPort, DNS_PORT, response))
            }
        }
    }

    /**
     * Best-effort passthrough for non-DNS UDP traffic (e.g. QUIC/HTTP3, or any other UDP-based
     * app protocol) so ordinary usage isn't entirely broken by this VPN's DNS-filtering purpose.
     * **Simplified, documented tradeoff**: this opens one fresh protected `DatagramSocket`, sends
     * the packet's UDP payload, blocks for a single reply, and relays it back — it is NOT a
     * persistent per-flow NAT session (a real NAT table keyed by source-port would be needed for
     * that). Adequate for simple one-request/one-response UDP traffic; a long-lived UDP stream
     * sending many packets will reopen a new socket per packet here, which is inefficient and can
     * drop/reorder packets under load. Real limitation, not hidden — see this file's header
     * comment for the bigger TCP gap this same tradeoff class belongs to.
     */
    private fun passthroughUdp(
        packet: ByteArray,
        ihl: Int,
        udpStart: Int,
        length: Int,
        srcPort: Int,
        destIp: String,
        destPort: Int,
        output: FileOutputStream,
    ) {
        try {
            val payloadStart = udpStart + 8
            val payloadLength = length - payloadStart
            if (payloadLength <= 0) return
            val payload = packet.copyOfRange(payloadStart, payloadStart + payloadLength)

            val socket = DatagramSocket()
            protect(socket)
            socket.use {
                it.soTimeout = UDP_PASSTHROUGH_TIMEOUT_MS
                it.send(java.net.DatagramPacket(payload, payload.size, java.net.InetSocketAddress(destIp, destPort)))

                val replyBuffer = ByteArray(TUN_MTU)
                val replyPacket = java.net.DatagramPacket(replyBuffer, replyBuffer.size)
                it.receive(replyPacket)

                val responsePacket = DnsWireFormat.buildIpv4UdpPacket(
                    packet,
                    ihl,
                    srcPort,
                    destPort,
                    replyBuffer.copyOfRange(0, replyPacket.length),
                )
                output.write(responsePacket)
            }
        } catch (e: Exception) {
            // Timeout or unreachable destination — drop; the sending app's own retry/timeout
            // handles it, same as a real dropped UDP packet on any network.
        }
    }

    /** Resolves `domain` against a real upstream resolver, using a VPN-`protect()`-ed socket so
     * the lookup itself doesn't get routed back into this same TUN interface (infinite loop). */
    private fun queryUpstream(domain: String): List<java.net.InetAddress> {
        return try {
            val socket = DatagramSocket()
            protect(socket)
            socket.use { DnsWireFormat.resolveViaUpstream(it, domain, UPSTREAM_DNS_SERVER) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** Requirement 3: periodically checks for a competing VPN/proxy app or a private-DNS
     * override while this service is running — either would let DNS traffic bypass this
     * service's own interception, so both are reported as tamper (`BypassPrevention.
     * checkForBypassAttempts`), not just an explicit stop of this service. */
    private fun runBypassCheckLoop() {
        while (running) {
            try {
                BypassPrevention.checkForBypassAttempts(applicationContext)
            } catch (e: Exception) {
                // Best-effort detection — must never crash the service over it.
            }
            try {
                Thread.sleep(BYPASS_CHECK_INTERVAL_MS)
            } catch (e: InterruptedException) {
                return
            }
        }
    }

    private fun buildForegroundNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Guardian protection",
                NotificationManager.IMPORTANCE_LOW,
            )
            manager?.createNotificationChannel(channel)
        }
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Guardian is protecting this device")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TUN_ADDRESS = "10.0.0.2"
        private const val TUN_MTU = 32000
        private const val PROTOCOL_UDP = 17
        private const val PROTOCOL_TCP = 6
        private const val DNS_PORT = 53
        private const val DOH_PORT = 443
        private const val DOT_PORT = 853
        private const val UDP_PASSTHROUGH_TIMEOUT_MS = 5000
        private const val BYPASS_CHECK_INTERVAL_MS = 60_000L
        // Cloudflare — a well-known, low-latency public resolver; matches spec §4's own KPI
        // framing ("<10ms added latency per query"). A production build may want this
        // parent-configurable instead of hardcoded.
        private const val UPSTREAM_DNS_SERVER = "1.1.1.1"
        private const val NOTIFICATION_ID = 1001
        private const val NOTIFICATION_CHANNEL_ID = "guardian_vpn"

        /** Read by `VpnModule.isActive()`. */
        @Volatile var isRunning: Boolean = false
            private set

        /** Set by `VpnModule.stopVpn()` immediately before it calls `stopService`, so
         * `onDestroy()` can tell a parent-initiated stop apart from tamper (system-killed,
         * force-stopped, VPN-permission-revoked). Consumed (reset to false) on every `onDestroy`. */
        @Volatile var expectedStop: Boolean = false
    }
}
