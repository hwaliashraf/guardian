package com.guardian.vpn

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Daily background refresh of the merged blocklist (spec §4: "continuously updated blocklists").
 * Requires `androidx.work:work-runtime-ktx` — added to `app/android/app/build.gradle`
 * specifically for this ticket's literal "daily WorkManager job" requirement (a ticket-mandated
 * dependency, not a convenience add — see LEDGER.md's T22 entry).
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class BlocklistRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val count = BlocklistLoader.refresh(applicationContext)
            Result.success(Data.Builder().putInt(RESULT_KEY_DOMAIN_COUNT, count).build())
        } catch (e: Exception) {
            // WorkManager's own built-in exponential backoff handles retry timing — no custom
            // retry loop needed here.
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "guardian_blocklist_refresh"
        const val RESULT_KEY_DOMAIN_COUNT = "domainCount"

        /** Schedules (or re-affirms) the daily refresh job. Idempotent (`KEEP` policy) — safe to
         * call every app/VPN start from `VpnModule.startVpn()`. */
        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<BlocklistRefreshWorker>(1, TimeUnit.DAYS)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
