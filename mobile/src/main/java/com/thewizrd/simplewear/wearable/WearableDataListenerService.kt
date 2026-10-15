package com.thewizrd.simplewear.wearable

import android.content.Intent
import android.os.Build
import androidx.core.util.Pair
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.thewizrd.shared_resources.actions.Action
import com.thewizrd.shared_resources.actions.ActionStatus
import com.thewizrd.shared_resources.actions.Actions
import com.thewizrd.shared_resources.actions.AudioStreamState
import com.thewizrd.shared_resources.actions.AudioStreamType
import com.thewizrd.shared_resources.actions.TimedAction
import com.thewizrd.shared_resources.actions.ValueActionState
import com.thewizrd.shared_resources.helpers.AppState
import com.thewizrd.shared_resources.helpers.GestureUIHelper
import com.thewizrd.shared_resources.helpers.InCallUIHelper
import com.thewizrd.shared_resources.helpers.MediaHelper
import com.thewizrd.shared_resources.helpers.WearableHelper
import com.thewizrd.shared_resources.utils.JSONParser
import com.thewizrd.shared_resources.utils.bytesToBool
import com.thewizrd.shared_resources.utils.bytesToInt
import com.thewizrd.shared_resources.utils.bytesToString
import com.thewizrd.shared_resources.utils.longToBytes
import com.thewizrd.shared_resources.utils.stringToBytes
import com.thewizrd.simplewear.MainActivity
import com.thewizrd.simplewear.helpers.PhoneStatusHelper
import com.thewizrd.simplewear.media.MediaAppControllerUtils
import com.thewizrd.simplewear.media.MediaControllerService
import com.thewizrd.simplewear.preferences.Settings
import com.thewizrd.simplewear.services.CallControllerService
import com.thewizrd.simplewear.services.NotificationListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking

class WearableDataListenerService : WearableListenerService() {
    companion object {
        private const val TAG = "WearableDataListenerService"
        const val ACTION_GETCONNECTEDNODE = "SimpleWear.Droid.action.GET_CONNECTED_NODE"
        const val EXTRA_NODEDEVICENAME = "SimpleWear.Droid.extra.NODE_DEVICE_NAME"
        private const val JOB_ID = 1000
    }

    private lateinit var mWearMgr: WearableManager

    override fun onCreate() {
        super.onCreate()
        mWearMgr = WearableManager(this)
    }

    override fun onDestroy() {
        mWearMgr.unregister()
        super.onDestroy()
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        runBlocking(Dispatchers.Default) {
            WearMessageHandler(this@WearableDataListenerService, mWearMgr)
                .handle(messageEvent.path, messageEvent.data, messageEvent.sourceNodeId)
        }
    }

    override fun onDataChanged(dataEventBuffer: DataEventBuffer) {
        super.onDataChanged(dataEventBuffer)

        for (event in dataEventBuffer) {
            if (event.type == DataEvent.TYPE_CHANGED) {
                val item = event.dataItem
                if (item.uri.path == WearableHelper.AppsIconSettingsPath) {
                    runCatching {
                        val dataMap = DataMapItem.fromDataItem(item).dataMap
                        if (dataMap.containsKey(WearableHelper.KEY_ICON)) {
                            val loadIcons = dataMap.getBoolean(WearableHelper.KEY_ICON)
                            Settings.setLoadAppIcons(loadIcons)
                        }
                    }
                    break
                }
            }
        }
    }
}