package dev.jjn8805.canvasnotes.widgets

import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/** A small box over the home screen to type a note or a to-do, without opening the app. */
class InputActivity : AppCompatActivity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val list = intent.getStringExtra("list").orEmpty()
        setContentView(R.layout.cnw_input)
        val name = if (list.isEmpty()) null else Store.list(this, list)?.optString("title")
        findViewById<TextView>(R.id.cnw_input_title).text =
            if (name == null) getString(R.string.widget_capture_title) else getString(R.string.widget_add_to, name)
        val field = findViewById<EditText>(R.id.cnw_input_field)
        field.requestFocus()
        findViewById<View>(R.id.cnw_input_cancel).setOnClickListener { finish() }
        findViewById<View>(R.id.cnw_input_save).setOnClickListener {
            val text = field.text.toString().trim()
            if (text.isNotEmpty()) {
                val ok = if (list.isEmpty()) Store.capture(this, text) else Store.add(this, list, text.replace('\n', ' '))
                if (!ok) {
                    Toast.makeText(this, R.string.widget_queue_full, Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                Widgets.refreshAll(this)
                Toast.makeText(this, R.string.widget_saved, Toast.LENGTH_SHORT).show()
            }
            finish()
        }
    }
}
