package dev.jjn8805.canvasnotes.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONObject

class ListWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        Rows(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID))
}

/** The rows of one to-do widget: open items first, ticked ones after them. */
private class Rows(private val c: Context, private val widget: Int) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<JSONObject> = emptyList()

    override fun onCreate() {}
    override fun onDestroy() {}

    override fun onDataSetChanged() {
        val items = Store.list(c, Store.chosen(c, widget) ?: "today")?.optJSONArray("items")
        val all = if (items == null) emptyList() else (0 until items.length()).map { items.getJSONObject(it) }
        rows = all.sortedBy { it.optBoolean("done") }
    }

    override fun getCount() = rows.size

    override fun getViewAt(position: Int): RemoteViews {
        val v = RemoteViews(c.packageName, R.layout.cnw_list_item)
        val item = rows.getOrNull(position) ?: return v
        val done = item.optBoolean("done")
        v.setTextViewText(R.id.cnw_item_check, if (done) "☑" else "☐")
        v.setTextViewText(R.id.cnw_item_text, item.optString("text"))
        val from = item.optString("from")
        v.setTextViewText(R.id.cnw_item_from, from)
        v.setViewVisibility(R.id.cnw_item_from, if (from.isEmpty()) android.view.View.GONE else android.view.View.VISIBLE)
        v.setInt(R.id.cnw_item_text, "setPaintFlags", if (done) Paint.STRIKE_THRU_TEXT_FLAG or Paint.ANTI_ALIAS_FLAG else Paint.ANTI_ALIAS_FLAG)
        v.setContentDescription(R.id.cnw_item_row, (if (done) "Done: " else "To do: ") + item.optString("text"))
        v.setOnClickFillInIntent(R.id.cnw_item_row, Intent().putExtra("ref", item.optString("ref")).putExtra("done", !done))
        return v
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount() = 1
    override fun getItemId(position: Int) = rows.getOrNull(position)?.optString("ref")?.hashCode()?.toLong() ?: position.toLong()
    override fun hasStableIds() = true
}
