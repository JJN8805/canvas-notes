//! The network side of the AI add-on.
//!
//! The page never talks to a model provider itself and never holds an API key: it describes a request, and this
//! module sends it. That keeps the app's content security policy strict (no outside `connect-src`), lets the key
//! live in a file the page can't read, and lets this code refuse anything but the three destinations the add-on
//! is for: Ollama (an address you chose), api.anthropic.com and api.openai.com.
//!
//! Keys are kept in `ai-keys.json` in the app's config folder (owner-only permissions on Unix). They are not in
//! the notes database, so they are never synced, backed up or exported.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle, Manager, State};

/// The most a request body or a response may weigh (a generated picture is a few megabytes of base64).
const MAX_BODY: usize = 24 * 1024 * 1024;
const MAX_RESPONSE: u64 = 48 * 1024 * 1024;
/// How much of an error response is kept to show the user.
const MAX_ERROR_BODY: u64 = 64 * 1024;
const MAX_KEY_LEN: usize = 400;

#[derive(Default)]
pub struct AiState {
    /// Ids of requests the page has asked to stop.
    cancelled: Arc<Mutex<HashSet<String>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    id: String,
    provider: String,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    /// true: send the answer line by line as it arrives; false: send it whole.
    stream: bool,
}

/// What the page hears back. `Failed` carries the HTTP status and body when the server answered with an error,
/// or just a message when it could not be reached.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiChunk {
    Line { text: String },
    Body { text: String },
    Done,
    Failed { status: Option<u16>, message: String, body: String },
}

/// Providers whose key this module keeps.
const KEYED: [&str; 2] = ["anthropic", "openai"];

/// Checks where a request is going. Returns the provider's key name when a key is to be added.
pub fn check_target(provider: &str, method: &str, url: &str) -> Result<Option<&'static str>, String> {
    if method != "GET" && method != "POST" {
        return Err("Only GET and POST requests are allowed.".into());
    }
    let u = url::Url::parse(url).map_err(|_| "The address isn't valid.".to_string())?;
    if !u.username().is_empty() || u.password().is_some() {
        return Err("Addresses with a user name or password aren't allowed.".into());
    }
    let host = u.host_str().unwrap_or("");
    match provider {
        "anthropic" => {
            if u.scheme() != "https" || host != "api.anthropic.com" || u.port().is_some() || !u.path().starts_with("/v1/") {
                return Err("Claude requests may only go to https://api.anthropic.com/v1/.".into());
            }
            Ok(Some("anthropic"))
        }
        "openai" => {
            if u.scheme() != "https" || host != "api.openai.com" || u.port().is_some() || !u.path().starts_with("/v1/") {
                return Err("OpenAI requests may only go to https://api.openai.com/v1/.".into());
            }
            Ok(Some("openai"))
        }
        "ollama" => {
            if u.scheme() != "http" && u.scheme() != "https" {
                return Err("The Ollama address must start with http:// or https://.".into());
            }
            if host.is_empty() {
                return Err("The Ollama address has no host.".into());
            }
            Ok(None)
        }
        _ => Err("Unknown provider.".into()),
    }
}

/// Only these headers come from the page. Keys are added here, never taken from the page.
pub fn filter_headers(headers: &[(String, String)]) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if !matches!(lower.as_str(), "content-type" | "accept" | "anthropic-version") {
            continue;
        }
        if value.bytes().any(|b| b < 0x20 || b == 0x7f) {
            return Err("A header value has control characters.".into());
        }
        out.push((lower, value.clone()));
    }
    Ok(out)
}

/// The header that carries a provider's key.
fn key_header(key_name: &str, key: &str) -> (String, String) {
    match key_name {
        "anthropic" => ("x-api-key".into(), key.into()),
        _ => ("authorization".into(), format!("Bearer {key}")),
    }
}

/// A key as typed or pasted: trimmed, and refused if it could break out of a header.
pub fn clean_key(raw: &str) -> Result<String, String> {
    let key = raw.trim();
    if key.is_empty() {
        return Err("The key is empty.".into());
    }
    if key.len() > MAX_KEY_LEN || key.bytes().any(|b| b < 0x21 || b > 0x7e) {
        return Err("That doesn't look like an API key (it has spaces or odd characters).".into());
    }
    Ok(key.to_string())
}

/* ------------------------------ key file ------------------------------ */

fn key_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ai-keys.json"))
}

fn read_keys(path: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write_keys(path: &Path, keys: &HashMap<String, String>) -> Result<(), String> {
    let json = serde_json::to_string(keys).map_err(|e| e.to_string())?;
    // Written to a new file first, so a crash never leaves half a key file, and so the owner-only mode is set before any key is inside.
    let tmp = path.with_extension("json.tmp");
    {
        use std::io::Write;
        #[cfg(unix)]
        let mut f = {
            use std::os::unix::fs::OpenOptionsExt;
            std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)
        }
        .map_err(|e| e.to_string())?;
        #[cfg(not(unix))]
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn keyed(provider: &str) -> Result<&str, String> {
    KEYED.iter().find(|p| **p == provider).copied().ok_or_else(|| "That provider doesn't use a key.".to_string())
}

#[tauri::command]
pub fn ai_key_set(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let provider = keyed(&provider)?;
    let key = clean_key(&key)?;
    let path = key_file(&app)?;
    let mut keys = read_keys(&path);
    keys.insert(provider.to_string(), key);
    write_keys(&path, &keys)
}

#[tauri::command]
pub fn ai_key_has(app: AppHandle, provider: String) -> Result<bool, String> {
    let provider = keyed(&provider)?;
    Ok(read_keys(&key_file(&app)?).contains_key(provider))
}

#[tauri::command]
pub fn ai_key_clear(app: AppHandle, provider: String) -> Result<(), String> {
    let provider = keyed(&provider)?;
    let path = key_file(&app)?;
    let mut keys = read_keys(&path);
    keys.remove(provider);
    write_keys(&path, &keys)
}

/* ------------------------------ requests ------------------------------ */

#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, id: String) {
    state.cancelled.lock().unwrap().insert(id);
}

#[tauri::command]
pub async fn ai_request(app: AppHandle, state: State<'_, AiState>, req: AiRequest, on_chunk: Channel<AiChunk>) -> Result<(), String> {
    let key_name = check_target(&req.provider, &req.method, &req.url)?;
    let headers = filter_headers(&req.headers)?;
    if req.body.as_ref().map_or(0, |b| b.len()) > MAX_BODY {
        return Err("That request is too large.".into());
    }
    let mut all = headers;
    if let Some(name) = key_name {
        let keys = read_keys(&key_file(&app)?);
        let key = keys.get(name).ok_or_else(|| "No API key is saved for this provider. Add it in Settings → Add-ons.".to_string())?;
        all.push(key_header(name, key));
    }
    let cancelled = state.cancelled.clone();
    let id = req.id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let is_cancelled = || cancelled.lock().unwrap().contains(&id);
        run_request(&req, &all, &mut |c| {
            let _ = on_chunk.send(c);
        }, &is_cancelled);
        cancelled.lock().unwrap().remove(&id);
    })
    .await;
    result.map_err(|e| e.to_string())
}

/// A transport failure in words for the user. The raw error is only added when it says something the words don't.
fn unreachable_message(provider: &str, host: &str, e: &ureq::Transport) -> String {
    use ureq::ErrorKind::*;
    let hint = match (e.kind(), provider) {
        (ConnectionFailed, "ollama") => "Is Ollama running there?".to_string(),
        (Dns, "ollama") => "Check the address in Settings → Add-ons.".to_string(),
        (ConnectionFailed | Dns, _) => "Check your internet connection.".to_string(),
        _ => e.to_string(),
    };
    format!("Couldn't reach {host}. {hint}")
}

/// Sends the request and reports what comes back. Never fails: every outcome, errors included, is a chunk.
pub fn run_request(req: &AiRequest, headers: &[(String, String)], emit: &mut dyn FnMut(AiChunk), is_cancelled: &dyn Fn() -> bool) {
    // No redirects: a redirect would carry the key to wherever it points.
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(300))
        .build();
    let mut r = agent.request(&req.method, &req.url);
    for (n, v) in headers {
        r = r.set(n, v);
    }
    let sent = match &req.body {
        Some(b) => r.send_string(b),
        None => r.call(),
    };
    let resp = match sent {
        Ok(resp) => resp,
        Err(ureq::Error::Status(code, resp)) => {
            let mut body = String::new();
            let _ = resp.into_reader().take(MAX_ERROR_BODY).read_to_string(&mut body);
            emit(AiChunk::Failed { status: Some(code), message: String::new(), body });
            return;
        }
        Err(ureq::Error::Transport(t)) => {
            let host = url::Url::parse(&req.url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
            emit(AiChunk::Failed { status: None, message: unreachable_message(&req.provider, &host, &t), body: String::new() });
            return;
        }
    };
    // With redirects off, a 3xx comes back as an ordinary response: report it instead of treating its empty body as an answer.
    if (300..400).contains(&resp.status()) {
        emit(AiChunk::Failed { status: Some(resp.status()), message: "The server tried to send the request somewhere else, which isn't allowed.".into(), body: String::new() });
        return;
    }
    if req.stream {
        let reader = BufReader::new(resp.into_reader().take(MAX_RESPONSE));
        for line in reader.lines() {
            if is_cancelled() {
                break;
            }
            match line {
                Ok(text) => emit(AiChunk::Line { text: text.trim_end_matches('\r').to_string() }),
                Err(e) => {
                    emit(AiChunk::Failed { status: None, message: format!("The connection broke: {e}"), body: String::new() });
                    return;
                }
            }
        }
    } else {
        let mut text = String::new();
        match resp.into_reader().take(MAX_RESPONSE).read_to_string(&mut text) {
            Ok(_) => emit(AiChunk::Body { text }),
            Err(e) => {
                emit(AiChunk::Failed { status: None, message: format!("The connection broke: {e}"), body: String::new() });
                return;
            }
        }
    }
    emit(AiChunk::Done);
}

#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod tests {
    use super::*;

    fn h(n: &str, v: &str) -> (String, String) {
        (n.to_string(), v.to_string())
    }

    #[test]
    fn sends_each_provider_only_to_its_own_servers() {
        assert_eq!(check_target("anthropic", "POST", "https://api.anthropic.com/v1/messages"), Ok(Some("anthropic")));
        assert_eq!(check_target("openai", "POST", "https://api.openai.com/v1/chat/completions"), Ok(Some("openai")));
        assert_eq!(check_target("ollama", "POST", "http://localhost:11434/api/chat"), Ok(None));
        assert_eq!(check_target("ollama", "GET", "https://ollama.example.com/api/tags"), Ok(None));
        for (p, url) in [
            ("anthropic", "https://api.anthropic.com.evil.com/v1/messages"),
            ("anthropic", "http://api.anthropic.com/v1/messages"),
            ("anthropic", "https://evil.com/v1/messages"),
            ("anthropic", "https://api.anthropic.com:8443/v1/messages"),
            ("anthropic", "https://api.anthropic.com/admin/keys"),
            ("anthropic", "https://user:pw@api.anthropic.com/v1/messages"),
            ("anthropic", "https://api.anthropic.com@evil.com/v1/messages"),
            ("openai", "https://api.openai.com/v2/x"),
            ("openai", "https://api.openai.com.evil.com/v1/x"),
            ("openai", "http://api.openai.com/v1/x"),
            ("ollama", "ftp://localhost/x"),
            ("ollama", "file:///etc/passwd"),
            ("ollama", "http://user:pw@localhost:11434/api/chat"),
            ("ollama", "not a url"),
            ("someone-else", "https://api.openai.com/v1/x"),
        ] {
            assert!(check_target(p, "POST", url).is_err(), "{p} {url} should be refused");
        }
        assert!(check_target("ollama", "DELETE", "http://localhost:11434/api/delete").is_err());
        assert!(check_target("ollama", "PUT", "http://localhost:11434/api/x").is_err());
    }

    #[test]
    fn takes_only_harmless_headers_from_the_page() {
        let got = filter_headers(&[h("Content-Type", "application/json"), h("Authorization", "Bearer stolen"), h("X-Api-Key", "k"), h("anthropic-version", "2023-06-01"), h("Cookie", "a=b"), h("Host", "evil.com")]).unwrap();
        assert_eq!(got, vec![h("content-type", "application/json"), h("anthropic-version", "2023-06-01")]);
        assert!(filter_headers(&[h("content-type", "a\r\nX-Injected: 1")]).is_err());
    }

    #[test]
    fn keys_go_in_the_right_header_and_bad_keys_are_refused() {
        assert_eq!(key_header("anthropic", "sk-ant-1"), h("x-api-key", "sk-ant-1"));
        assert_eq!(key_header("openai", "sk-1"), h("authorization", "Bearer sk-1"));
        assert_eq!(clean_key("  sk-abc_123  "), Ok("sk-abc_123".to_string()));
        for bad in ["", "   ", "has space", "new\nline", "tab\tkey", "ключ", &"x".repeat(401)] {
            assert!(clean_key(bad).is_err(), "{bad:?}");
        }
        assert!(keyed("anthropic").is_ok() && keyed("openai").is_ok());
        assert!(keyed("ollama").is_err() && keyed("evil").is_err());
    }

    #[test]
    fn keeps_keys_in_a_private_file_and_forgets_them() {
        let dir = std::env::temp_dir().join(format!("cn-ai-keys-{}-{}", std::process::id(), line!()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ai-keys.json");
        assert!(read_keys(&path).is_empty());
        let mut keys = HashMap::new();
        keys.insert("openai".to_string(), "sk-1".to_string());
        write_keys(&path, &keys).unwrap();
        assert_eq!(read_keys(&path).get("openai").map(String::as_str), Some("sk-1"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        keys.remove("openai");
        write_keys(&path, &keys).unwrap();
        assert!(read_keys(&path).is_empty());
        assert!(!path.with_extension("json.tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A one-shot local server: answers the first request with the given status, headers and body.
    fn serve(status: u16, content_type: &'static str, body: &'static str) -> (String, std::thread::JoinHandle<Vec<(String, String)>>) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", server.server_addr().to_ip().unwrap());
        let t = std::thread::spawn(move || {
            let req = server.recv().unwrap();
            let seen: Vec<(String, String)> = req.headers().iter().map(|h| (h.field.to_string().to_lowercase(), h.value.to_string())).collect();
            let resp = tiny_http::Response::from_string(body)
                .with_status_code(status)
                .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap());
            req.respond(resp).unwrap();
            seen
        });
        (addr, t)
    }

    fn request(url: String, stream: bool, body: Option<&str>) -> AiRequest {
        AiRequest { id: "t".into(), provider: "ollama".into(), method: if body.is_some() { "POST" } else { "GET" }.into(), url, headers: vec![], body: body.map(str::to_string), stream }
    }

    fn collect(req: &AiRequest, headers: &[(String, String)], cancel_after: Option<usize>) -> Vec<AiChunk> {
        let mut out = Vec::new();
        let n = std::cell::Cell::new(0usize);
        run_request(req, headers, &mut |c| out.push(c), &|| {
            n.set(n.get() + 1);
            cancel_after.is_some_and(|k| n.get() > k)
        });
        out
    }

    #[test]
    fn streams_lines_as_they_come_and_ends_with_done() {
        let (addr, t) = serve(200, "application/x-ndjson", "{\"a\":1}\r\n\r\n{\"b\":2}\n");
        let got = collect(&request(format!("{addr}/api/chat"), true, Some("{}")), &[h("content-type", "application/json")], None);
        let seen = t.join().unwrap();
        assert_eq!(got, vec![AiChunk::Line { text: "{\"a\":1}".into() }, AiChunk::Line { text: String::new() }, AiChunk::Line { text: "{\"b\":2}".into() }, AiChunk::Done]);
        assert!(seen.contains(&h("content-type", "application/json")));
    }

    #[test]
    fn can_be_stopped_part_way() {
        let (addr, t) = serve(200, "text/plain", "1\n2\n3\n4\n");
        let got = collect(&request(format!("{addr}/x"), true, Some("{}")), &[], Some(2));
        t.join().unwrap();
        let lines = got.iter().filter(|c| matches!(c, AiChunk::Line { .. })).count();
        assert_eq!(lines, 2);
        assert_eq!(got.last(), Some(&AiChunk::Done));
    }

    #[test]
    fn returns_a_whole_answer_when_not_streaming() {
        let (addr, t) = serve(200, "application/json", "{\"models\":[]}");
        let got = collect(&request(format!("{addr}/api/tags"), false, None), &[], None);
        t.join().unwrap();
        assert_eq!(got, vec![AiChunk::Body { text: "{\"models\":[]}".into() }, AiChunk::Done]);
    }

    #[test]
    fn reports_an_error_status_with_its_body() {
        let (addr, t) = serve(404, "application/json", "{\"error\":\"model 'x' not found\"}");
        let got = collect(&request(format!("{addr}/api/chat"), true, Some("{}")), &[], None);
        t.join().unwrap();
        assert_eq!(got, vec![AiChunk::Failed { status: Some(404), message: String::new(), body: "{\"error\":\"model 'x' not found\"}".into() }]);
    }

    #[test]
    fn does_not_follow_redirects_so_a_key_can_never_be_forwarded() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", server.server_addr().to_ip().unwrap());
        let t = std::thread::spawn(move || {
            let req = server.recv().unwrap();
            let loc = tiny_http::Header::from_bytes(&b"Location"[..], &b"http://127.0.0.1:1/stolen"[..]).unwrap();
            req.respond(tiny_http::Response::empty(302).with_header(loc)).unwrap();
        });
        let got = collect(&request(format!("{addr}/api/chat"), true, Some("{}")), &[h("authorization", "Bearer secret")], None);
        t.join().unwrap();
        assert!(matches!(got.as_slice(), [AiChunk::Failed { status: Some(302), .. }]), "{got:?}");
    }

    #[test]
    fn says_so_when_nothing_is_listening() {
        let got = collect(&request("http://127.0.0.1:1/api/chat".into(), true, Some("{}")), &[], None);
        match got.as_slice() {
            [AiChunk::Failed { status: None, message, .. }] => assert_eq!(message, "Couldn't reach 127.0.0.1. Is Ollama running there?"),
            other => panic!("{other:?}"),
        }
    }

    /// Real HTTPS from this module, with no key and no data: OpenAI answers a keyless request with 401, which proves the
    /// TLS stack and certificate roots work. Not run by default (it uses the internet): `cargo test -- --ignored https_works`.
    #[test]
    #[ignore]
    fn https_works() {
        let req = AiRequest { id: "t".into(), provider: "openai".into(), method: "GET".into(), url: "https://api.openai.com/v1/models".into(), headers: vec![], body: None, stream: false };
        let got = collect(&req, &[], None);
        assert!(matches!(got.as_slice(), [AiChunk::Failed { status: Some(401), .. }]), "{got:?}");
    }
}
