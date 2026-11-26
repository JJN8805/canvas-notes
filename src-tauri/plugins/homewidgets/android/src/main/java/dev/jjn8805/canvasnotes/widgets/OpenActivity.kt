package dev.jjn8805.canvasnotes.widgets

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** No screen of its own: remembers which page was asked for, then opens the app, which reads it. */
class OpenActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val page = intent.getStringExtra("page").orEmpty()
        if (page.isNotEmpty()) Store.open(this, page)
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        finish()
    }
}
