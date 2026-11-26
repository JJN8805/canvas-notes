package dev.jjn8805.canvasnotes.widgets

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * What the widgets know and what was done on them. Two small files in the app's private, never-backed-up folder:
 * `snapshot.json` (written by the app: lists and pages) and `actions.json` (taps and typed notes waiting for the app).
 * A change made on a widget is queued **and** applied to the snapshot at once, so the widget shows it while the app is closed;
 * the app applies the queue to the real notes next time it runs, then acknowledges it.
 */
object Store {
    private const val MAX_ACTIONS = 500
    const val MAX_TEXT = 4000
    private val lock = Any()

    private fun dir(c: Context) = File(c.noBackupFilesDir, "widgets").apply { mkdirs() }

    private fun read(f: File): String? = if (f.exists()) f.readText() else null

    private fun write(f: File, text: String) {
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(f)) {
            f.writeText(text)
            tmp.delete()
        }
    }

    private fun json(text: String?): JSONObject? = try { text?.let { JSONObject(it) } } catch (e: Exception) { null }

    private fun actions(c: Context): JSONArray = try { JSONArray(read(File(dir(c), "actions.json")) ?: "[]") } catch (e: Exception) { JSONArray() }

    fun snapshot(c: Context): JSONObject = synchronized(lock) { json(read(File(dir(c), "snapshot.json"))) ?: JSONObject() }

    /** The app's fresh snapshot. Anything still queued is laid over it, so it does not vanish before the app has applied it. */
    fun publish(c: Context, text: String) = synchronized(lock) {
        val s = json(text) ?: return@synchronized
        val q = actions(c)
        for (i in 0 until q.length()) apply(s, q.getJSONObject(i))
        write(File(dir(c), "snapshot.json"), s.toString())
    }

    fun pending(c: Context): String = synchronized(lock) { actions(c).toString() }

    fun waiting(c: Context): Int = synchronized(lock) {
        val q = actions(c)
        var n = 0
        for (i in 0 until q.length()) if (q.getJSONObject(i).optString("type") != "open") n++
        n
    }

    fun ack(c: Context, ids: Set<String>) = synchronized(lock) {
        val q = actions(c)
        val left = JSONArray()
        for (i in 0 until q.length()) {
            val a = q.getJSONObject(i)
            if (!ids.contains(a.optString("id"))) left.put(a)
        }
        write(File(dir(c), "actions.json"), left.toString())
    }

    private fun queue(c: Context, a: JSONObject) = synchronized(lock) {
        a.put("id", UUID.randomUUID().toString()).put("at", System.currentTimeMillis())
        val q = actions(c)
        // The oldest are never dropped to make room: a full queue refuses new work instead, so nothing typed disappears silently.
        if (q.length() >= MAX_ACTIONS) return@synchronized false
        q.put(a)
        write(File(dir(c), "actions.json"), q.toString())
        val s = snapshot(c)
        apply(s, a)
        write(File(dir(c), "snapshot.json"), s.toString())
        true
    }

    fun toggle(c: Context, ref: String, done: Boolean) = queue(c, JSONObject().put("type", "toggle").put("ref", ref).put("done", done))
    fun add(c: Context, list: String, text: String) = queue(c, JSONObject().put("type", "add").put("list", list).put("text", text.take(MAX_TEXT)))
    fun capture(c: Context, text: String) = queue(c, JSONObject().put("type", "capture").put("text", text.take(MAX_TEXT)))
    fun open(c: Context, page: String) = queue(c, JSONObject().put("type", "open").put("page", page))

    /** Shows an action in the snapshot (what the app will do with it). */
    private fun apply(s: JSONObject, a: JSONObject) {
        val lists = s.optJSONArray("lists") ?: return
        when (a.optString("type")) {
            "toggle" -> {
                val item = a.optString("ref").substringAfterLast('|')
                for (i in 0 until lists.length()) {
                    val items = lists.getJSONObject(i).optJSONArray("items") ?: continue
                    for (k in 0 until items.length()) {
                        val it = items.getJSONObject(k)
                        if (it.optString("ref").substringAfterLast('|') == item) it.put("done", a.optBoolean("done"))
                    }
                }
            }
            "add" -> {
                val list = a.optString("list")
                val itemId = "w" + a.optString("id").replace("-", "")
                for (i in 0 until lists.length()) {
                    val l = lists.getJSONObject(i)
                    if (l.optString("id") != list) continue
                    val items = l.optJSONArray("items") ?: JSONArray().also { l.put("items", it) }
                    val ref = (if (list == "today") "inbox|inbox" else list) + "|" + itemId
                    var there = false
                    for (k in 0 until items.length()) if (items.getJSONObject(k).optString("ref").endsWith("|$itemId")) there = true
                    if (!there) items.put(JSONObject().put("ref", ref).put("text", a.optString("text")).put("done", false))
                }
            }
        }
    }

    fun list(c: Context, id: String): JSONObject? {
        val lists = snapshot(c).optJSONArray("lists") ?: return null
        for (i in 0 until lists.length()) if (lists.getJSONObject(i).optString("id") == id) return lists.getJSONObject(i)
        return null
    }

    fun page(c: Context, id: String): JSONObject? {
        val pages = snapshot(c).optJSONArray("pages") ?: return null
        for (i in 0 until pages.length()) if (pages.getJSONObject(i).optString("id") == id) return pages.getJSONObject(i)
        return null
    }

    /* Which list or page each placed widget shows. */
    private fun prefs(c: Context) = c.getSharedPreferences("cn_widgets", Context.MODE_PRIVATE)
    fun choose(c: Context, widget: Int, value: String) = prefs(c).edit().putString("w$widget", value).apply()
    fun chosen(c: Context, widget: Int): String? = prefs(c).getString("w$widget", null)
    fun forget(c: Context, widget: Int) = prefs(c).edit().remove("w$widget").apply()
}
