package com.thewizrd.simplewear.zepp

import android.content.Context
import android.content.Intent
import android.util.Log
import com.thewizrd.shared_resources.actions.Action
import com.thewizrd.shared_resources.actions.ActionStatus
import com.thewizrd.shared_resources.utils.Logger
import com.thewizrd.simplewear.MainActivity
import com.thewizrd.wearsettings.actions.ActionHelper

/**
 * The SimpleWear Helper (wearsettings module) compiled into this app.
 *
 * Upstream ships the Helper as a separate targetSdk 28 APK because a Play Store app has to target
 * a recent SDK. This fork is sideloaded and targets 28 itself, so the same action code runs here.
 */
object BuiltInHelper {
    val isAvailable: Boolean
        get() = true

    fun performAction(context: Context, action: Action): ActionStatus {
        val status = try {
            ActionHelper.performAction(context, action)
        } catch (e: Exception) {
            Logger.writeLine(Log.ERROR, e)
            ActionStatus.FAILURE
        }

        // WearableManager reacts to the REMOTE_* codes it used to get from the Helper service
        return when (status) {
            ActionStatus.FAILURE -> ActionStatus.REMOTE_FAILURE
            ActionStatus.PERMISSION_DENIED -> ActionStatus.REMOTE_PERMISSION_DENIED
            else -> status
        }
    }

    /** Upstream opens the Helper app here so the user can grant Shizuku / root access */
    fun openSettings(context: Context) {
        runCatching {
            context.startActivity(
                Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }.onFailure {
            Logger.writeLine(Log.ERROR, it)
        }
    }
}
