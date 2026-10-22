package com.thewizrd.simplewear.zepp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.PhoneStateListener
import android.telephony.SignalStrength
import android.telephony.TelephonyManager
import android.util.Log
import com.thewizrd.simplewear.helpers.PhoneStatusHelper
import org.json.JSONObject

/**
 * Wi-Fi and cellular signal levels (0..4) for the Zepp OS watch; SimpleWear itself only sends
 * on/off states. Sent as `/status/signal` when the watch asks for status and whenever a level
 * or an on/off state changes.
 */
class SignalMonitor(private val context: Context) {
    companion object {
        const val PATH = "/status/signal"
        private const val TAG = "SignalMonitor"
        private const val LEVELS = 5
        private const val IDLE_CHECK_MS = 35_000L
    }

    private val wifiManager = context.applicationContext.getSystemService(WifiManager::class.java)
    private val telephonyManager = context.getSystemService(TelephonyManager::class.java)
    private val connectivityManager = context.getSystemService(ConnectivityManager::class.java)

    @Volatile
    private var cellLevel = 0

    // AOSP reports 0..4, but OEM builds may use more bins (MagicOS: 0..5, like its 5-bar icon)
    @Volatile
    private var cellMax = 4
    private var lastSent: String? = null

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            sendIfChanged()
        }
    }

    @Suppress("DEPRECATION")
    private val phoneListener = object : PhoneStateListener() {
        override fun onSignalStrengthsChanged(signalStrength: SignalStrength) {
            cellLevel = signalStrength.level
            cellMax = maxOf(cellMax, cellLevel)
            sendIfChanged()
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var listening = false

    // RSSI and signal strength change constantly: listen only while the watch is polling,
    // otherwise every change would wake the phone all night
    private val idleCheck = object : Runnable {
        override fun run() {
            if (ZeppBridge.isConnected()) mainHandler.postDelayed(this, IDLE_CHECK_MS) else stop()
        }
    }

    /** Called on every watch poll; cheap when already listening */
    fun ensureListening() {
        mainHandler.post {
            if (listening) return@post
            start()
            mainHandler.postDelayed(idleCheck, IDLE_CHECK_MS)
        }
    }

    @Suppress("DEPRECATION")
    private fun start() {
        listening = true
        Log.d(TAG, "listening")
        context.registerReceiver(receiver, IntentFilter().apply {
            addAction(WifiManager.RSSI_CHANGED_ACTION)
            addAction(WifiManager.NETWORK_STATE_CHANGED_ACTION)
            addAction(WifiManager.WIFI_STATE_CHANGED_ACTION)
            addAction(ConnectivityManager.CONNECTIVITY_ACTION)
        })
        runCatching {
            telephonyManager?.listen(phoneListener, PhoneStateListener.LISTEN_SIGNAL_STRENGTHS)
        }.onFailure { Log.e(TAG, "signal listener", it) }
    }

    @Suppress("DEPRECATION")
    fun stop() {
        mainHandler.removeCallbacks(idleCheck)
        if (!listening) return
        listening = false
        Log.d(TAG, "stopped (watch not polling)")
        runCatching { context.unregisterReceiver(receiver) }
        runCatching { telephonyManager?.listen(phoneListener, PhoneStateListener.LISTEN_NONE) }
    }

    /** The watch asked for the full status: always send */
    fun sendNow() {
        lastSent = null
        sendIfChanged()
    }

    @Synchronized
    private fun sendIfChanged() {
        // Not polled: nothing to send, and the next poll starts with sendNow() anyway
        if (!ZeppBridge.isConnected()) return
        val json = snapshot().toString()
        if (json == lastSent) return
        lastSent = json
        ZeppBridge.enqueue(PATH, json.toByteArray(Charsets.UTF_8))
    }

    @Suppress("DEPRECATION")
    private fun snapshot(): JSONObject {
        val wifiEnabled = PhoneStatusHelper.isWifiEnabled(context)
        val wifiConnected = wifiEnabled && isWifiConnected()
        val wifiLevel = if (wifiConnected) {
            runCatching { WifiManager.calculateSignalLevel(wifiManager.connectionInfo.rssi, LEVELS) }
                .getOrDefault(0)
        } else 0

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            telephonyManager?.signalStrength?.let {
                cellLevel = it.level
                cellMax = maxOf(cellMax, cellLevel)
            }
        }

        return JSONObject()
            .put("wifiEnabled", wifiEnabled)
            .put("wifiConnected", wifiConnected)
            .put("wifiLevel", wifiLevel)
            .put("dataEnabled", PhoneStatusHelper.isMobileDataEnabled(context))
            .put("cellLevel", cellLevel)
            .put("cellMax", cellMax)
    }

    private fun isWifiConnected(): Boolean = runCatching {
        connectivityManager.allNetworks.any { network ->
            connectivityManager.getNetworkCapabilities(network)
                ?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        }
    }.getOrDefault(false)
}
