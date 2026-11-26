package dev.jjn8805.canvasnotes.widgets

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/** "What should this widget show?": a to-do list or a page, from the names the app last published. */
class ChooseActivity : AppCompatActivity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setResult(Activity.RESULT_CANCELED)
        val widget = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val manager = AppWidgetManager.getInstance(this)
        val provider = manager.getAppWidgetInfo(widget)?.provider
        // Only this app's own widgets: another app opening this screen changes nothing.
        if (provider == null || provider.packageName != packageName) return finish()
        val pages = provider.className == PageWidget::class.java.name
        val source = Store.snapshot(this).optJSONArray(if (pages) "pages" else "lists")
        val ids = ArrayList<String>()
        val names = ArrayList<String>()
        if (source != null) for (i in 0 until source.length()) {
            val o = source.getJSONObject(i)
            ids.add(o.optString("id"))
            names.add(o.optString("title"))
        }
        setContentView(R.layout.cnw_choose)
        findViewById<TextView>(R.id.cnw_choose_title).setText(if (pages) R.string.widget_choose_page else R.string.widget_choose_list)
        val empty = findViewById<TextView>(R.id.cnw_choose_empty)
        empty.visibility = if (ids.isEmpty()) View.VISIBLE else View.GONE
        val list = findViewById<ListView>(R.id.cnw_choose_list)
        list.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, names)
        list.setOnItemClickListener { _, _, position, _ ->
            Store.choose(this, widget, ids[position])
            Widgets.refreshAll(this)
            setResult(Activity.RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widget))
            finish()
        }
        // With nothing published yet, keep the widget: it explains that the app has to be opened once, and it can be changed later.
        if (ids.isEmpty()) setResult(Activity.RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widget))
        findViewById<View>(R.id.cnw_choose_close).setOnClickListener { finish() }
    }
}
