package dev.jjn8805.canvasnotes.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews

/** A to-do list on the home screen: tap a row to tick it, + to add one, the title to open it in the app. */
class ListWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
        for (id in ids) draw(c, m, id)
        m.notifyAppWidgetViewDataChanged(ids, R.id.cnw_list)
    }

    override fun onDeleted(c: Context, ids: IntArray) {
        for (id in ids) Store.forget(c, id)
    }

    override fun onReceive(c: Context, intent: Intent) {
        if (intent.action == TOGGLE) {
            val ref = intent.getStringExtra("ref") ?: return
            Store.toggle(c, ref, intent.getBooleanExtra("done", false))
            Widgets.refreshAll(c)
        } else super.onReceive(c, intent)
    }

    companion object {
        const val TOGGLE = "dev.jjn8805.canvasnotes.widgets.TOGGLE"

        fun draw(c: Context, m: AppWidgetManager, id: Int) {
            val chosen = Store.chosen(c, id) ?: "today"
            val list = Store.list(c, chosen)
            val v = RemoteViews(c.packageName, R.layout.cnw_list)
            v.setTextViewText(R.id.cnw_title, list?.optString("title") ?: c.getString(R.string.widget_list_name))
            val items = list?.optJSONArray("items")
            var open = 0
            if (items != null) for (i in 0 until items.length()) if (!items.getJSONObject(i).optBoolean("done")) open++
            v.setTextViewText(R.id.cnw_count, if (items == null) "" else open.toString())
            v.setTextViewText(
                R.id.cnw_empty,
                c.getString(if (list == null) R.string.widget_open_app_first else R.string.widget_nothing_to_do),
            )
            val service = Intent(c, ListWidgetService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            service.data = Uri.parse("cnwidget://list/$id")
            @Suppress("DEPRECATION")
            v.setRemoteAdapter(R.id.cnw_list, service)
            v.setEmptyView(R.id.cnw_list, R.id.cnw_empty)
            v.setPendingIntentTemplate(R.id.cnw_list, Widgets.rowTemplate(c, id))
            val page = if (chosen == "today") null else chosen.substringBefore('|')
            v.setOnClickPendingIntent(R.id.cnw_title, Widgets.open(c, page, "list-$id"))
            v.setOnClickPendingIntent(R.id.cnw_add, Widgets.input(c, chosen, "list-$id"))
            v.setOnClickPendingIntent(R.id.cnw_change, Widgets.choose(c, id))
            v.setViewVisibility(R.id.cnw_add, if (list == null) View.GONE else View.VISIBLE)
            m.updateAppWidget(id, v)
        }
    }
}
