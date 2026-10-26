package com.thewizrd.simplewear.zepp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import com.thewizrd.shared_resources.appLib
import com.thewizrd.shared_resources.helpers.WearableHelper
import com.thewizrd.shared_resources.utils.Logger
import com.thewizrd.simplewear.R
import com.thewizrd.simplewear.wearable.WearMessageHandler
import com.thewizrd.simplewear.wearable.WearableManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Watch <-> phone transport for Zepp OS.
 *
 * The Zepp app-side (JS running inside the Zepp phone app) can only make HTTP requests, so this
 * service listens on the loopback interface and feeds requests into the same handler the
 * Wear OS Data Layer listener uses:
 *
 *  - `POST /pair`     {nonce, name}       pairing; the user approves it from a notification
 *  - `POST /message`  {path, text | b64}  watch -> phone message (Wear OS MessageClient path)
 *  - `GET  /events?wait=ms`               phone -> watch messages, long poll (max 8 s)
 *  - `GET  /ping`
 *
 * Every call except /ping and /pair needs the `X-Bridge-Token` header handed out by /pair,
 * because any app on the phone can reach a loopback port.
 */
class ZeppBridgeService : Service() {
    companion object {
        private const val TAG = "ZeppBridgeService"

        private const val NOT_CHANNEL_ID = "SimpleWear.zeppbridge"
        private const val NOT_ID = 0x2E99
        private const val PAIR_NOT_ID = 0x2E9A

        private const val ACTION_APPROVE_PAIR = "SimpleWear.zeppbridge.action.APPROVE_PAIR"
        private const val ACTION_DENY_PAIR = "SimpleWear.zeppbridge.action.DENY_PAIR"
        private const val EXTRA_NONCE = "nonce"

        private const val KEY_TOKEN = "key_zeppbridge_token"
        private const val TOKEN_HEADER = "x-bridge-token"
        private const val MAX_BODY = 1024 * 1024

        @Volatile
        private var running = false

        /** One notification for the whole app: watch link + the media player being controlled */
        fun buildNotification(context: Context): Notification {
            val nm = context.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        NOT_CHANNEL_ID,
                        context.getString(R.string.zepp_bridge_channel),
                        NotificationManager.IMPORTANCE_LOW
                    )
                )
            }
            var status = context.getString(
                if (ZeppBridge.isConnected()) R.string.zepp_bridge_connected else R.string.zepp_bridge_running
            )
            ZeppBridge.mediaApp?.let { status += " · " + context.getString(R.string.zepp_bridge_media, it) }
            return NotificationCompat.Builder(context, NOT_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_settings_phone_24dp)
                .setContentTitle(context.getString(R.string.zepp_bridge_title))
                .setContentText(status)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
        }

        /** Re-posts the notification, e.g. when the controlled player changes */
        fun refreshNotification(context: Context) {
            if (!running) return
            context.getSystemService(NotificationManager::class.java).notify(NOT_ID, buildNotification(context))
        }

        fun start(context: Context) {
            runCatching {
                ContextCompat.startForegroundService(
                    context, Intent(context, ZeppBridgeService::class.java)
                )
            }.onFailure {
                Logger.writeLine(Log.ERROR, it, "%s: unable to start", TAG)
            }
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var wearMgr: WearableManager
    private lateinit var handler: WearMessageHandler
    private lateinit var signal: SignalMonitor

    private var server: ServerSocket? = null
    private var pool: ExecutorService? = null

    // Pairing state: one pending request at a time, identified by the app-side's nonce
    @Volatile
    private var pendingNonce: String? = null

    @Volatile
    private var approvedNonce: String? = null

    override fun onCreate() {
        super.onCreate()
        wearMgr = WearableManager(this)
        handler = WearMessageHandler(this, wearMgr)
        signal = SignalMonitor(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()

        when (intent?.action) {
            ACTION_APPROVE_PAIR -> {
                val nonce = intent.getStringExtra(EXTRA_NONCE)
                if (nonce != null && nonce == pendingNonce) {
                    ensureToken()
                    approvedNonce = nonce
                    Logger.info(TAG, "pairing approved")
                }
                cancelPairNotification()
            }
            ACTION_DENY_PAIR -> {
                pendingNonce = null
                cancelPairNotification()
            }
        }

        if (server == null) startServer()
        return START_STICKY
    }

    override fun onDestroy() {
        runCatching { server?.close() }
        server = null
        pool?.shutdownNow()
        pool = null
        running = false
        scope.cancel()
        signal.stop()
        wearMgr.unregister()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startForegroundCompat() {
        running = true
        val notif = buildNotification(this)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOT_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOT_ID, notif)
        }
    }

    private fun updateNotification() {
        startForegroundCompat()
        // fall back to "waiting" once the watch stops polling
        scope.launch {
            kotlinx.coroutines.delay(35_000)
            if (!ZeppBridge.isConnected()) startForegroundCompat() else updateNotificationLater()
        }
    }

    private fun updateNotificationLater() {
        scope.launch {
            kotlinx.coroutines.delay(35_000)
            if (!ZeppBridge.isConnected()) startForegroundCompat() else updateNotificationLater()
        }
    }

    /* Server */

    private fun startServer() {
        val executor = Executors.newCachedThreadPool()
        pool = executor
        executor.execute {
            try {
                val socket = ServerSocket()
                socket.reuseAddress = true
                // Loopback only: the Zepp app runs on this phone. Explicit IPv4, since
                // getLoopbackAddress() may return ::1 and Zepp connects to 127.0.0.1
                socket.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), ZeppBridge.PORT))
                server = socket
                Log.i(TAG, "listening on 127.0.0.1:${ZeppBridge.PORT}")
                while (!socket.isClosed) {
                    val client = socket.accept()
                    executor.execute { handle(client) }
                }
            } catch (e: IOException) {
                Log.e(TAG, "server stopped", e)
            } finally {
                server = null
            }
        }
    }

    private fun handle(client: Socket) {
        // The phone may be asleep: keep the CPU up while answering (long poll included)
        val wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SimpleWear:zeppbridge")
        wakeLock.acquire(ZeppBridge.MAX_WAIT_MS + 5000)

        try {
            client.use { sock ->
                sock.soTimeout = 15000
                val request = readRequest(BufferedInputStream(sock.getInputStream())) ?: return
                // Cover art is binary; the app-side downloads it with network.downloader
                if (request.path == "/media/art") {
                    serveArtwork(request, sock.getOutputStream())
                    return
                }
                val (code, body) = try {
                    route(request)
                } catch (e: Exception) {
                    Log.e(TAG, "${request.method} ${request.path} failed", e)
                    500 to JSONObject().put("error", e.toString())
                }
                respond(sock.getOutputStream(), code, body.toString())
            }
        } catch (e: IOException) {
            // Client went away (Zepp gives up after ~10 s); nothing to answer
        } finally {
            if (wakeLock.isHeld) wakeLock.release()
        }
    }

    private fun route(req: Request): Pair<Int, JSONObject> {
        if (req.path != "/events") Log.d(TAG, "${req.method} ${req.path}")
        if (req.path == "/ping") {
            return 200 to JSONObject().put("ok", true).put("paired", getToken() != null)
        }
        if (req.method == "POST" && req.path == "/pair") {
            return pair(req)
        }

        val token = getToken()
        if (token == null || req.headers[TOKEN_HEADER] != token) {
            return 401 to JSONObject().put("error", "unauthorized")
        }

        return when {
            req.method == "POST" && req.path == "/message" -> {
                val json = JSONObject(String(req.body, StandardCharsets.UTF_8))
                val path = json.getString("path")
                Log.d(TAG, "message $path ${json.optString("text").take(300)}")
                val data = when {
                    json.has("b64") -> Base64.decode(json.getString("b64"), Base64.DEFAULT)
                    json.has("text") -> json.getString("text").toByteArray(StandardCharsets.UTF_8)
                    else -> ByteArray(0)
                }
                // Media commands go to MediaControllerService, which listens on its own
                ZeppBridge.dispatch(path, data)
                // Replies (if any) come back through /events, like Wear OS MessageClient
                scope.launch {
                    runCatching { handler.handle(path, data, ZeppBridge.NODE_ID) }
                        .onFailure { Log.e(TAG, "$path failed", it) }
                    // the watch (app or shortcut card) wants the full status: add signal levels
                    if (path == WearableHelper.AppStatePath) signal.sendNow()
                }
                200 to JSONObject().put("ok", true)
            }
            req.method == "GET" && req.path == "/events" -> {
                val wait = req.query["wait"]?.toLongOrNull() ?: ZeppBridge.MAX_WAIT_MS
                val wasConnected = ZeppBridge.isConnected()
                signal.ensureListening()
                val messages = ZeppBridge.take(wait)
                if (!wasConnected) updateNotification()
                messages.forEach { (p, d) ->
                    Log.d(TAG, "event $p ${d?.let { String(it, StandardCharsets.UTF_8) }?.take(300)}")
                }
                200 to ZeppBridge.toJson(messages)
            }
            else -> 404 to JSONObject().put("error", "not_found")
        }
    }

    private fun pair(req: Request): Pair<Int, JSONObject> {
        val json = runCatching { JSONObject(String(req.body, StandardCharsets.UTF_8)) }
            .getOrDefault(JSONObject())
        val nonce = json.optString("nonce")
        if (nonce.length < 8) return 400 to JSONObject().put("error", "bad_nonce")

        if (nonce == approvedNonce) {
            approvedNonce = null
            pendingNonce = null
            return 200 to JSONObject().put("status", "ok").put("token", getToken())
        }
        if (nonce != pendingNonce) {
            pendingNonce = nonce
            showPairNotification(nonce, json.optString("name", "Zepp OS"))
        }
        return 200 to JSONObject().put("status", "pending")
    }

    private fun showPairNotification(nonce: String, deviceName: String) {
        fun action(action: String, requestCode: Int) = PendingIntent.getService(
            this, requestCode,
            Intent(this, ZeppBridgeService::class.java)
                .setAction(action)
                .putExtra(EXTRA_NONCE, nonce),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif: Notification = NotificationCompat.Builder(this, NOT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_settings_phone_24dp)
            .setContentTitle(getString(R.string.zepp_bridge_pair_title))
            .setContentText(getString(R.string.zepp_bridge_pair_text, deviceName))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .addAction(0, getString(R.string.zepp_bridge_pair_allow), action(ACTION_APPROVE_PAIR, 1))
            .addAction(0, getString(R.string.zepp_bridge_pair_deny), action(ACTION_DENY_PAIR, 2))
            .build()
        getSystemService(NotificationManager::class.java).notify(PAIR_NOT_ID, notif)
    }

    private fun cancelPairNotification() {
        getSystemService(NotificationManager::class.java).cancel(PAIR_NOT_ID)
    }

    private fun getToken(): String? = appLib.preferences.getString(KEY_TOKEN, null)

    private fun ensureToken() {
        if (getToken() != null) return
        val bytes = ByteArray(24)
        SecureRandom().nextBytes(bytes)
        val token = bytes.joinToString("") { String.format("%02x", it) }
        appLib.preferences.edit { putString(KEY_TOKEN, token) }
    }

    /* Minimal HTTP/1.1 (one request per connection) */

    private class Request(
        val method: String,
        val path: String,
        val query: Map<String, String>,
        val headers: Map<String, String>,
        val body: ByteArray
    )

    private fun readRequest(input: InputStream): Request? {
        val requestLine = readLine(input) ?: return null
        val parts = requestLine.split(" ")
        if (parts.size < 2) return null

        val headers = mutableMapOf<String, String>()
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) break
            val idx = line.indexOf(':')
            if (idx > 0) headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
        }

        val length = (headers["content-length"]?.toIntOrNull() ?: 0).coerceIn(0, MAX_BODY)
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val r = input.read(body, read, length - read)
            if (r < 0) break
            read += r
        }

        val target = parts[1]
        val q = target.indexOf('?')
        val query = mutableMapOf<String, String>()
        if (q >= 0) {
            target.substring(q + 1).split('&').forEach { kv ->
                val p = kv.split('=', limit = 2)
                if (p.size == 2) query[p[0]] = p[1]
            }
        }
        return Request(parts[0], if (q >= 0) target.substring(0, q) else target, query, headers, body)
    }

    private fun readLine(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        var b: Int
        while (true) {
            b = input.read()
            if (b == -1 || b == '\n'.code) break
            if (b != '\r'.code) buf.write(b)
        }
        if (b == -1 && buf.size() == 0) return null
        return buf.toString("UTF-8")
    }

    // GET /media/art?id=<id>&t=<token>: the downloader can't send headers, so the token is a parameter
    private fun serveArtwork(req: Request, out: OutputStream) {
        val token = getToken()
        if (token == null || (req.query["t"] ?: req.headers[TOKEN_HEADER]) != token) {
            respond(out, 401, JSONObject().put("error", "unauthorized").toString())
            return
        }
        val art = ZeppBridge.artwork(req.query["id"])
        if (art == null) {
            respond(out, 404, JSONObject().put("error", "no_art").toString())
            return
        }
        respond(out, 200, art, "image/jpeg")
    }

    private fun respond(out: OutputStream, code: Int, json: String) {
        respond(out, code, json.toByteArray(StandardCharsets.UTF_8), "application/json; charset=utf-8")
    }

    private fun respond(out: OutputStream, code: Int, body: ByteArray, contentType: String) {
        val reason = when (code) {
            200 -> "OK"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            404 -> "Not Found"
            else -> "Error"
        }
        val head = "HTTP/1.1 $code $reason\r\n" +
                "Content-Type: $contentType\r\n" +
                "Content-Length: ${body.size}\r\n" +
                "Connection: close\r\n\r\n"
        out.write(head.toByteArray(StandardCharsets.US_ASCII))
        out.write(body)
        out.flush()
    }
}
