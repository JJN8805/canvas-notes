package dev.jjn8805.canvasnotes.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** One button: type a note without opening the app. It goes to the Inbox page when the app next runs. */
class CaptureWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
        for (id in ids) draw(c, m, id)
    }

    companion object {
        fun draw(c: Context, m: AppWidgetManager, id: Int) {
            val v = RemoteViews(c.packageName, R.layout.cnw_capture)
            val n = Store.waiting(c)
            v.setTextViewText(
                R.id.cnw_capture_hint,
                if (n == 0) c.getString(R.string.widget_capture_hint) else c.resources.getQuantityString(R.plurals.widget_waiting, n, n),
            )
            v.setOnClickPendingIntent(R.id.cnw_capture_root, Widgets.input(c, null, "capture-$id"))
            m.updateAppWidget(id, v)
        }
    }
}
