package com.thewizrd.simplewear.wearable

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.util.Pair
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.thewizrd.shared_resources.actions.Action
import com.thewizrd.shared_resources.actions.ActionStatus
import com.thewizrd.shared_resources.actions.Actions
import com.thewizrd.shared_resources.actions.AudioStreamState
import com.thewizrd.shared_resources.actions.AudioStreamType
import com.thewizrd.shared_resources.actions.TimedAction
import com.thewizrd.shared_resources.actions.ValueActionState
import com.thewizrd.shared_resources.helpers.AppState
import com.thewizrd.shared_resources.helpers.GestureUIHelper
import com.thewizrd.shared_resources.helpers.WearableHelper
import com.thewizrd.shared_resources.utils.JSONParser
import com.thewizrd.shared_resources.utils.bytesToBool
import com.thewizrd.shared_resources.utils.bytesToInt
import com.thewizrd.shared_resources.utils.bytesToString
import com.thewizrd.shared_resources.utils.longToBytes
import com.thewizrd.shared_resources.utils.stringToBytes
import com.thewizrd.simplewear.MainActivity
import com.thewizrd.simplewear.helpers.PhoneStatusHelper
import com.thewizrd.simplewear.preferences.Settings


/**
 * Handles a watch -> phone message. Shared by the Wear OS Data Layer listener and the
 * Zepp OS local HTTP bridge, so both transports run exactly the same phone-side logic.
 */
class WearMessageHandler(private val ctx: Context, private val mWearMgr: WearableManager) {
    // data is non-null for the Wear OS transport; the Zepp bridge passes an empty array when absent
    suspend fun handle(path: String, data: ByteArray, sourceNodeId: String) {
        if (path == WearableHelper.StartActivityPath) {
            val startIntent = Intent(ctx, MainActivity::class.java)
                .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            ctx.startActivity(startIntent)
        } else if (path.startsWith(WearableHelper.ActionsPath)) {
            val jsonData = data.bytesToString()
            val action = JSONParser.deserializer(jsonData, Action::class.java)
            mWearMgr.performAction(sourceNodeId, action!!)
        } else if (path.startsWith(WearableHelper.UpdatePath)) {
            mWearMgr.sendStatusUpdate(sourceNodeId, null)
            mWearMgr.sendActionsUpdate(sourceNodeId)
        } else if (path == WearableHelper.AppStatePath) {
            val wearAppState = AppState.valueOf(data.bytesToString())
            if (wearAppState == AppState.FOREGROUND) {
                mWearMgr.sendStatusUpdate(sourceNodeId, null)
                mWearMgr.sendActionsUpdate(sourceNodeId)
            }
        } else if (path == WearableHelper.BtDiscoverPath) {
            val deviceName = data.bytesToString()
            LocalBroadcastManager.getInstance(ctx)
                .sendBroadcast(
                    Intent(WearableDataListenerService.ACTION_GETCONNECTEDNODE)
                        .putExtra(WearableDataListenerService.EXTRA_NODEDEVICENAME, deviceName)
                )
        } else if (data != null && path == WearableHelper.AudioStatusPath) {
            mWearMgr.sendAudioModeStatus(
                sourceNodeId,
                AudioStreamType.valueOf(data.bytesToString())
            )
        } else if (path == WearableHelper.AudioVolumePath) {
            val jsonData = data.bytesToString()
            val streamData = JSONParser.deserializer(jsonData, AudioStreamState::class.java)
            streamData?.let {
                mWearMgr.setStreamVolume(sourceNodeId, it)
            }
        } else if (path == WearableHelper.ValueStatusPath) {
            val actionType = Actions.valueOf(data.bytesToInt())
            mWearMgr.sendValueStatus(sourceNodeId, actionType)
        } else if (path == WearableHelper.ValueStatusSetPath) {
            val jsonData = data.bytesToString()
            val valueData = JSONParser.deserializer(jsonData, ValueActionState::class.java)
            valueData?.let {
                mWearMgr.setActionValue(sourceNodeId, it)
            }
        } else if (path == WearableHelper.BrightnessModePath) {
            mWearMgr.toggleBrightnessMode(sourceNodeId)
        } else if (path == GestureUIHelper.GestureStatusPath) {
            mWearMgr.sendGestureActionStatus(sourceNodeId)
        } else if (path == WearableHelper.TimedActionsStatusPath) {
            mWearMgr.sendTimedActionsStatus(sourceNodeId)
        } else if (path.startsWith(WearableHelper.StatusPath)) {
            mWearMgr.sendStatusUpdate(sourceNodeId, path)
        } else if (path == WearableHelper.AppsPath) {
            mWearMgr.sendApps(sourceNodeId)
        } else if (path == WearableHelper.LaunchAppPath) {
            val jsonData = data.bytesToString()
            val pair = JSONParser.deserializer(jsonData, Pair::class.java)
            val pkgName = pair?.first.toString()
            val activityName = pair?.second.toString()
            mWearMgr.launchApp(sourceNodeId, pkgName, activityName)
        } else if (path == WearableHelper.VersionPath) {
            mWearMgr.sendMessage(
                sourceNodeId, path,
                WearableHelper.getAppVersionCode().longToBytes()
            )
        } else if (path == GestureUIHelper.ScrollPath) {
            mWearMgr.performScroll(sourceNodeId, data)
        } else if (path == GestureUIHelper.DPadPath && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val byteArr = data
            val idx = byteArr.indexOfFirst { it > 0 }

            mWearMgr.performDPadAction(sourceNodeId, idx)
        } else if (path == GestureUIHelper.DPadClickPath && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            mWearMgr.performDPadClick(sourceNodeId)
        } else if (path == GestureUIHelper.KeyEventPath) {
            mWearMgr.performKeyEvent(sourceNodeId, data.bytesToInt())
        } else if (path == WearableHelper.TimedActionDeletePath) {
            val action = Actions.valueOf(data.bytesToString())

            val status = PhoneStatusHelper.removedScheduledTimedAction(ctx, action)

            mWearMgr.sendMessage(
                sourceNodeId,
                path,
                status.name.stringToBytes()
            )
            mWearMgr.sendTimedActionsStatus(sourceNodeId)
        } else if (path == WearableHelper.TimedActionAddPath) {
            val jsonData = data.bytesToString()
            val action = JSONParser.deserializer(jsonData, TimedAction::class.java)

            val status = action?.let {
                PhoneStatusHelper.scheduleTimedAction(ctx, it)
            } ?: ActionStatus.FAILURE

            mWearMgr.sendMessage(
                sourceNodeId,
                path,
                status.name.stringToBytes()
            )
            mWearMgr.sendTimedActionsStatus(sourceNodeId)
        } else if (path == WearableHelper.TimedActionUpdatePath) {
            val jsonData = data.bytesToString()
            val action = JSONParser.deserializer(jsonData, TimedAction::class.java)

            val status = action?.let {
                PhoneStatusHelper.scheduleTimedAction(ctx, it)
            } ?: ActionStatus.FAILURE

            mWearMgr.sendMessage(
                sourceNodeId,
                path,
                status.name.stringToBytes()
            )
            mWearMgr.sendTimedActionsStatus(sourceNodeId)
        }
    }
}
