package dev.jjn8805.canvasnotes.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/** Shared helpers: redraw every widget, and the PendingIntents they use (all explicit, all for this app). */
object Widgets {
    fun ids(c: Context, cls: Class<*>): IntArray = AppWidgetManager.getInstance(c).getAppWidgetIds(ComponentName(c, cls))

    fun refreshAll(c: Context) {
        val m = AppWidgetManager.getInstance(c)
        for (id in ids(c, ListWidget::class.java)) ListWidget.draw(c, m, id)
        m.notifyAppWidgetViewDataChanged(ids(c, ListWidget::class.java), R.id.cnw_list)
        for (id in ids(c, CaptureWidget::class.java)) CaptureWidget.draw(c, m, id)
        for (id in ids(c, PageWidget::class.java)) PageWidget.draw(c, m, id)
    }

    private val immutable = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

    /** `key` makes each PendingIntent distinct (extras alone do not). */
    fun activity(c: Context, intent: Intent, key: String): PendingIntent {
        intent.data = Uri.parse("cnwidget://$key")
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        return PendingIntent.getActivity(c, 0, intent, immutable)
    }

    fun open(c: Context, page: String?, key: String) = activity(c, Intent(c, OpenActivity::class.java).putExtra("page", page ?: ""), "open/$key")

    fun input(c: Context, list: String?, key: String) = activity(c, Intent(c, InputActivity::class.java).putExtra("list", list ?: ""), "input/$key")

    fun choose(c: Context, widget: Int) =
        activity(c, Intent(c, ChooseActivity::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widget), "choose/$widget")

    /** The list's rows fill in this one, so it must be mutable; it is explicit, so nothing else can receive it. */
    fun rowTemplate(c: Context, widget: Int): PendingIntent {
        val i = Intent(c, ListWidget::class.java).setAction(ListWidget.TOGGLE)
        i.data = Uri.parse("cnwidget://row/$widget")
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        return PendingIntent.getBroadcast(c, 0, i, flags)
    }
}
