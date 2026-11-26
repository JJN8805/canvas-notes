package dev.jjn8805.canvasnotes.widgets

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class PublishArgs {
    lateinit var snapshot: String
}

@InvokeArg
class AckArgs {
    var ids: Array<String> = emptyArray()
}

@InvokeArg
class PinArgs {
    lateinit var kind: String
}

/** The app's side of the widgets: publish what they show, collect what was done on them, offer to add one. */
@TauriPlugin
class HomeWidgetsPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun publish(invoke: Invoke) {
        val args = invoke.parseArgs(PublishArgs::class.java)
        if (args.snapshot.length > 2_000_000) return invoke.reject("The widget snapshot is too large.")
        Store.publish(activity.applicationContext, args.snapshot)
        Widgets.refreshAll(activity.applicationContext)
        invoke.resolve()
    }

    @Command
    fun pending(invoke: Invoke) {
        invoke.resolve(JSObject().put("actions", Store.pending(activity.applicationContext)))
    }

    @Command
    fun ack(invoke: Invoke) {
        val args = invoke.parseArgs(AckArgs::class.java)
        Store.ack(activity.applicationContext, args.ids.toSet())
        Widgets.refreshAll(activity.applicationContext)
        invoke.resolve()
    }

    @Command
    fun status(invoke: Invoke) {
        val c = activity.applicationContext
        val n = Widgets.ids(c, ListWidget::class.java).size + Widgets.ids(c, CaptureWidget::class.java).size + Widgets.ids(c, PageWidget::class.java).size
        val canPin = Build.VERSION.SDK_INT >= 26 && AppWidgetManager.getInstance(c).isRequestPinAppWidgetSupported
        invoke.resolve(JSObject().put("placed", n).put("canPin", canPin))
    }

    @Command
    fun pin(invoke: Invoke) {
        val args = invoke.parseArgs(PinArgs::class.java)
        val cls = when (args.kind) {
            "list" -> ListWidget::class.java
            "capture" -> CaptureWidget::class.java
            "page" -> PageWidget::class.java
            else -> return invoke.reject("Unknown widget.")
        }
        val m = AppWidgetManager.getInstance(activity)
        val asked = Build.VERSION.SDK_INT >= 26 && m.isRequestPinAppWidgetSupported && m.requestPinAppWidget(ComponentName(activity, cls), null, null)
        invoke.resolve(JSObject().put("asked", asked))
    }
}
