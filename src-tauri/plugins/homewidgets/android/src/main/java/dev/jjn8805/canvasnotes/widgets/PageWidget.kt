package dev.jjn8805.canvasnotes.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** The words of one page, to read at a glance; tap to open it in the app. */
class PageWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
        for (id in ids) draw(c, m, id)
    }

    override fun onDeleted(c: Context, ids: IntArray) {
        for (id in ids) Store.forget(c, id)
    }

    companion object {
        fun draw(c: Context, m: AppWidgetManager, id: Int) {
            val chosen = Store.chosen(c, id)
            val page = chosen?.let { Store.page(c, it) }
            val v = RemoteViews(c.packageName, R.layout.cnw_page)
            v.setTextViewText(R.id.cnw_page_title, page?.optString("title") ?: c.getString(R.string.widget_page_name))
            v.setTextViewText(
                R.id.cnw_page_text,
                page?.optString("text")?.ifEmpty { c.getString(R.string.widget_page_empty) } ?: c.getString(R.string.widget_page_missing),
            )
            val open = Widgets.open(c, if (page != null) chosen else null, "page-$id")
            v.setOnClickPendingIntent(R.id.cnw_page_title, open)
            v.setOnClickPendingIntent(R.id.cnw_page_text, open)
            v.setOnClickPendingIntent(R.id.cnw_change, Widgets.choose(c, id))
            m.updateAppWidget(id, v)
        }
    }
}
