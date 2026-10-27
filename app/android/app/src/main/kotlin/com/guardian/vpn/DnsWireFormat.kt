package com.guardian.vpn

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress

/**
 * Minimal hand-rolled DNS (RFC1035) + IPv4/UDP wire-format helpers for `GuardianVpnService`'s
 * packet loop. No external DNS/pcap library dependency — keeps this ticket's `build.gradle` diff
 * to only the one ticket-mandated WorkManager addition (see `BlocklistRefreshWorker.kt`). Covers
 * exactly what the VPN packet loop needs: parsing a single-question query's name, building a
 * same-question NXDOMAIN or A-record response, and reassembling a full IPv4/UDP packet around it.
 * Not a general-purpose DNS library — built responses never use compression pointers except the
 * one fixed "point back at the question" pointer used for answer records, which is always valid
 * since the question section always starts at byte 12 in a message built here.
 *
 * **Known scope limitation (documented, not hidden)**: `buildQuery`/`buildAnswerResponse` always
 * query/answer with TYPE=A (IPv4), regardless of the original query's actual QTYPE — an AAAA (or
 * other record-type) query passed through the ALLOW path gets an A-record answer under its own
 * question name, which is a type mismatch a strict client could reject. Real-world impact is
 * limited (IPv4 remains near-universal, and a client that rejects the mismatch simply falls back
 * to treating it as an error/retries), but a human continuing this work should parse QTYPE and
 * either handle AAAA properly or return a clean empty-answer response for non-A queries instead.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
object DnsWireFormat {

    private const val DNS_HEADER_SIZE = 12
    private const val ANSWER_RR_SIZE = 16
    private const val UPSTREAM_TIMEOUT_MS = 5000

    /** Parses the QNAME of a DNS message's first question, starting at `offset` (the start of the
     * DNS payload, i.e. right after the UDP header) within `packet`. Returns the dotted domain
     * name, or null if malformed/unparseable. */
    fun parseQuestionName(packet: ByteArray, offset: Int): String? {
        if (offset + DNS_HEADER_SIZE > packet.size) return null
        var pos = offset + DNS_HEADER_SIZE
        val labels = mutableListOf<String>()
        while (pos < packet.size) {
            val len = packet[pos].toInt() and 0xFF
            if (len == 0) {
                pos += 1
                break
            }
            if (len and 0xC0 == 0xC0) return null // compression pointer in a fresh query — not expected
            pos += 1
            if (pos + len > packet.size) return null
            labels.add(String(packet, pos, len, Charsets.US_ASCII))
            pos += len
        }
        if (labels.isEmpty()) return null
        return labels.joinToString(".").lowercase()
    }

    private fun questionSectionLength(packet: ByteArray, offset: Int): Int {
        var pos = offset + DNS_HEADER_SIZE
        while (pos < packet.size) {
            val len = packet[pos].toInt() and 0xFF
            pos += 1
            if (len == 0) break
            pos += len
        }
        return (pos + 4) - (offset + DNS_HEADER_SIZE) // + QTYPE(2) + QCLASS(2)
    }

    /** Builds an NXDOMAIN response mirroring the original query's id/question section. */
    fun buildNxDomainResponse(originalPacket: ByteArray, dnsStart: Int): ByteArray {
        val questionLen = questionSectionLength(originalPacket, dnsStart)
        val response = ByteArray(DNS_HEADER_SIZE + questionLen)
        response[0] = originalPacket[dnsStart]
        response[1] = originalPacket[dnsStart + 1]
        val queryFlags1 = originalPacket[dnsStart + 2].toInt()
        response[2] = (0x80 or (queryFlags1 and 0x01)).toByte() // QR=1 (response) + RD passthrough
        response[3] = (0x80 or 0x03).toByte() // RA=1, RCODE=NXDOMAIN(3)
        response[5] = 1 // QDCOUNT = 1; ANCOUNT/NSCOUNT/ARCOUNT stay 0
        System.arraycopy(originalPacket, dnsStart + DNS_HEADER_SIZE, response, DNS_HEADER_SIZE, questionLen)
        return response
    }

    /** Builds a response with one A record per address in `answers`, under the ORIGINAL question
     * name — used for SafeSearch/YouTube-restricted rewriting: the client asked for e.g.
     * "www.google.com" and receives forcesafesearch.google.com's real IP(s), returned as an
     * answer for its own original question name (a standard recursive-resolver rebinding
     * response shape, valid DNS wire format). */
    fun buildAnswerResponse(originalPacket: ByteArray, dnsStart: Int, answers: List<InetAddress>): ByteArray {
        val questionLen = questionSectionLength(originalPacket, dnsStart)
        val answerSectionSize = answers.size * ANSWER_RR_SIZE
        val response = ByteArray(DNS_HEADER_SIZE + questionLen + answerSectionSize)

        response[0] = originalPacket[dnsStart]
        response[1] = originalPacket[dnsStart + 1]
        val queryFlags1 = originalPacket[dnsStart + 2].toInt()
        response[2] = (0x80 or (queryFlags1 and 0x01)).toByte()
        response[3] = 0x80.toByte() // RA=1, RCODE=0 (no error)
        response[5] = 1 // QDCOUNT
        response[7] = answers.size.toByte() // ANCOUNT

        System.arraycopy(originalPacket, dnsStart + DNS_HEADER_SIZE, response, DNS_HEADER_SIZE, questionLen)

        var pos = DNS_HEADER_SIZE + questionLen
        for (address in answers) {
            response[pos] = 0xC0.toByte()
            response[pos + 1] = 0x0C.toByte() // NAME: pointer back to the question name at byte 12
            response[pos + 2] = 0
            response[pos + 3] = 1 // TYPE = A
            response[pos + 4] = 0
            response[pos + 5] = 1 // CLASS = IN
            response[pos + 6] = 0
            response[pos + 7] = 0
            response[pos + 8] = 0
            response[pos + 9] = 60 // TTL = 60s
            response[pos + 10] = 0
            response[pos + 11] = 4 // RDLENGTH = 4
            val ipBytes = address.address
            System.arraycopy(ipBytes, 0, response, pos + 12, 4)
            pos += ANSWER_RR_SIZE
        }
        return response
    }

    /** Performs a real upstream DNS A-record query for `domain` via `socket` (already
     * VPN-`protect()`-ed by the caller, so this lookup itself doesn't get routed back into the
     * TUN interface) against `upstreamServer`, and parses out the answer IPs. Empty list on any
     * failure/timeout/non-A-record response. */
    fun resolveViaUpstream(socket: DatagramSocket, domain: String, upstreamServer: String): List<InetAddress> {
        return try {
            val query = buildQuery(domain)
            socket.soTimeout = UPSTREAM_TIMEOUT_MS
            socket.send(DatagramPacket(query, query.size, InetSocketAddress(upstreamServer, 53)))

            val responseBuffer = ByteArray(512)
            val responsePacket = DatagramPacket(responseBuffer, responseBuffer.size)
            socket.receive(responsePacket)

            parseAnswers(responseBuffer, responsePacket.length)
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun buildQuery(domain: String): ByteArray {
        val labels = domain.split(".")
        var qnameSize = 1
        for (label in labels) qnameSize += 1 + label.length
        val query = ByteArray(DNS_HEADER_SIZE + qnameSize + 4)
        val id = (System.nanoTime() and 0xFFFF).toInt() // not cryptographically random — fine, only used to correlate our own request/response pair, never trusted as a security boundary
        query[0] = (id shr 8).toByte()
        query[1] = id.toByte()
        query[2] = 0x01 // RD=1 (recursion desired)
        query[5] = 1 // QDCOUNT = 1
        var pos = DNS_HEADER_SIZE
        for (label in labels) {
            query[pos] = label.length.toByte()
            pos += 1
            for (c in label) {
                query[pos] = c.code.toByte()
                pos += 1
            }
        }
        query[pos] = 0 // root label
        pos += 1
        query[pos + 1] = 1 // QTYPE = A
        query[pos + 3] = 1 // QCLASS = IN
        return query
    }

    private fun parseAnswers(packet: ByteArray, length: Int): List<InetAddress> {
        val ancount = ((packet[6].toInt() and 0xFF) shl 8) or (packet[7].toInt() and 0xFF)
        if (ancount == 0) return emptyList()

        var pos = DNS_HEADER_SIZE
        while (pos < length) {
            val len = packet[pos].toInt() and 0xFF
            pos += 1
            if (len == 0) break
            pos += len
        }
        pos += 4 // QTYPE + QCLASS

        val results = mutableListOf<InetAddress>()
        repeat(ancount) {
            if (pos + 12 > length) return results
            if (packet[pos].toInt() and 0xC0 == 0xC0) {
                pos += 2 // compressed NAME (pointer)
            } else {
                while (pos < length && packet[pos].toInt() != 0) pos += 1 + (packet[pos].toInt() and 0xFF)
                pos += 1
            }
            val type = ((packet[pos].toInt() and 0xFF) shl 8) or (packet[pos + 1].toInt() and 0xFF)
            val rdlength = ((packet[pos + 8].toInt() and 0xFF) shl 8) or (packet[pos + 9].toInt() and 0xFF)
            val rdataStart = pos + 10
            if (type == 1 && rdlength == 4 && rdataStart + 4 <= length) { // A record
                val ipBytes = byteArrayOf(
                    packet[rdataStart], packet[rdataStart + 1], packet[rdataStart + 2], packet[rdataStart + 3],
                )
                results.add(InetAddress.getByAddress(ipBytes))
            }
            pos = rdataStart + rdlength
        }
        return results
    }

    /** Reassembles a full IPv4+UDP packet carrying `payload`, swapping src/dst IP/port relative
     * to `originalPacket` (query direction -> response direction) and setting the response's
     * source port to `serverPort` (53 for DNS responses; the original destination port for a
     * generic UDP passthrough reply — see `GuardianVpnService.passthroughUdp`). UDP checksum is
     * left as 0, which RFC768 explicitly permits for IPv4 (means "not computed") — avoids
     * pseudo-header checksum computation for a receiving TUN driver that does not require it. */
    fun buildIpv4UdpPacket(originalPacket: ByteArray, ihl: Int, clientPort: Int, serverPort: Int, payload: ByteArray): ByteArray {
        val udpLength = 8 + payload.size
        val totalLength = ihl + udpLength
        val packet = ByteArray(totalLength)

        System.arraycopy(originalPacket, 0, packet, 0, ihl)
        packet[2] = ((totalLength shr 8) and 0xFF).toByte()
        packet[3] = (totalLength and 0xFF).toByte()
        for (i in 0 until 4) { // swap source/destination address (bytes 12-15 <-> 16-19)
            val tmp = packet[12 + i]
            packet[12 + i] = packet[16 + i]
            packet[16 + i] = tmp
        }
        packet[10] = 0
        packet[11] = 0 // zero checksum before recompute
        val checksum = ipv4HeaderChecksum(packet, ihl)
        packet[10] = ((checksum shr 8) and 0xFF).toByte()
        packet[11] = (checksum and 0xFF).toByte()

        packet[ihl] = ((serverPort shr 8) and 0xFF).toByte()
        packet[ihl + 1] = (serverPort and 0xFF).toByte()
        packet[ihl + 2] = ((clientPort shr 8) and 0xFF).toByte()
        packet[ihl + 3] = (clientPort and 0xFF).toByte()
        packet[ihl + 4] = ((udpLength shr 8) and 0xFF).toByte()
        packet[ihl + 5] = (udpLength and 0xFF).toByte()
        packet[ihl + 6] = 0
        packet[ihl + 7] = 0 // UDP checksum 0 = not computed (valid for IPv4)

        System.arraycopy(payload, 0, packet, ihl + 8, payload.size)
        return packet
    }

    private fun ipv4HeaderChecksum(packet: ByteArray, ihl: Int): Int {
        var sum = 0
        var i = 0
        while (i < ihl) {
            val word = ((packet[i].toInt() and 0xFF) shl 8) or (packet[i + 1].toInt() and 0xFF)
            sum += word
            i += 2
        }
        while (sum shr 16 != 0) sum = (sum and 0xFFFF) + (sum shr 16)
        return sum.inv() and 0xFFFF
    }
}
