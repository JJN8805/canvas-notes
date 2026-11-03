//! Wi-Fi sync transport.
//!
//! Rust only moves encrypted bytes; all sync decisions live in TypeScript
//! (`src/sync/engine.ts`), which reads and writes the same SQLite database
//! the rest of the app uses.
//!
//! * The laptop runs a tiny HTTP server on port 47821. Each request is
//!   decrypted, handed to the UI as a `sync://request` event, and the UI's
//!   answer (sent back with `sync_server_reply`) is encrypted and returned.
//! * The phone sends requests with `sync_client_request`.
//!
//! Every message is sealed with ChaCha20-Poly1305 using a key derived from the
//! pairing code, so the code itself never crosses the network and other
//! devices on the Wi-Fi can neither read nor forge sync traffic. Messages carry
//! a timestamp and are rejected if they are more than five minutes old.

use std::time::{SystemTime, UNIX_EPOCH};

use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    ChaCha20Poly1305, Key, Nonce,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::guard::check_peer_url;

pub const PORT: u16 = 47821;
const MAX_BODY: u64 = 256 * 1024 * 1024;
const MAX_SKEW_MS: i64 = 5 * 60 * 1000;

#[derive(Serialize, Deserialize)]
struct Envelope {
    ts: i64,
    body: String,
}

enum OpenError {
    BadKey,
    Stale,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Key = SHA-256 over a fixed label and the pairing code (letters and digits only, upper-cased).
fn derive_key(code: &str) -> [u8; 32] {
    let norm: String = code
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    let mut h = Sha256::new();
    h.update(b"canvas-notes/sync/v1\0");
    h.update(norm.as_bytes());
    h.finalize().into()
}

fn seal(key: &[u8; 32], body: String) -> Result<Vec<u8>, String> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    let plain = serde_json::to_vec(&Envelope { ts: now_ms(), body }).map_err(|e| e.to_string())?;
    let sealed = cipher
        .encrypt(&nonce, plain.as_ref())
        .map_err(|_| "Encryption failed".to_string())?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&sealed);
    Ok(out)
}

fn open(key: &[u8; 32], data: &[u8]) -> Result<String, OpenError> {
    if data.len() < 12 + 16 {
        return Err(OpenError::BadKey);
    }
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let plain = cipher
        .decrypt(Nonce::from_slice(&data[..12]), &data[12..])
        .map_err(|_| OpenError::BadKey)?;
    let env: Envelope = serde_json::from_slice(&plain).map_err(|_| OpenError::BadKey)?;
    if (now_ms() - env.ts).abs() > MAX_SKEW_MS {
        return Err(OpenError::Stale);
    }
    Ok(env.body)
}

/// "desktop" or "mobile": decides whether the UI offers the server or the client side.
#[tauri::command]
pub fn sync_platform() -> &'static str {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        "mobile"
    } else {
        "desktop"
    }
}

/* ------------------------------------------------------------------ */
/* Client (phone)                                                      */
/* ------------------------------------------------------------------ */

/// Sends one encrypted request to the laptop and returns its decrypted reply.
/// Uses a plain socket from Rust, so Android's WebView rules for unencrypted
/// HTTP don't apply (the payload is encrypted anyway).
#[tauri::command]
pub async fn sync_client_request(url: String, code: String, body: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || client_request(&url, &code, body))
        .await
        .map_err(|e| e.to_string())?
}

fn client_request(url: &str, code: &str, body: String) -> Result<String, String> {
    use std::io::Read;
    use std::time::Duration;

    // The address comes from the UI; only a laptop on the local network is allowed.
    check_peer_url(url)?;
    let key = derive_key(code);
    let sealed = seal(&key, body)?;
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(6))
        .timeout(Duration::from_secs(180))
        .build();
    match agent
        .post(url)
        .set("Content-Type", "application/octet-stream")
        .send_bytes(&sealed)
    {
        Ok(resp) => {
            let mut data = Vec::new();
            resp.into_reader()
                .take(MAX_BODY)
                .read_to_end(&mut data)
                .map_err(|e| format!("The connection dropped while receiving data ({e})."))?;
            open(&key, &data).map_err(|e| match e {
                OpenError::BadKey => "The laptop's reply couldn't be decrypted. Check the pairing code.".to_string(),
                OpenError::Stale => "The phone's and laptop's clocks differ by more than 5 minutes. Turn on automatic time on both.".to_string(),
            })
        }
        Err(ureq::Error::Status(401, _)) => {
            Err("The laptop didn't accept the pairing code. Check it matches the code shown on the laptop.".into())
        }
        Err(ureq::Error::Status(408, _)) => Err(
            "The phone's and laptop's clocks differ by more than 5 minutes. Turn on automatic time on both.".into(),
        ),
        Err(ureq::Error::Status(503, _)) => Err("Phone sync is turned off on the laptop.".into()),
        Err(ureq::Error::Status(code, _)) => Err(format!("The laptop answered with error {code}.")),
        Err(ureq::Error::Transport(t)) => Err(format!(
            "Couldn't reach the laptop. Check that Canvas Notes is open on it, phone sync is on, and both are on the same Wi-Fi. ({t})"
        )),
    }
}

/* ------------------------------------------------------------------ */
/* Server (laptop)                                                     */
/* ------------------------------------------------------------------ */

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod server {
    use super::*;
    use crate::guard::{Limiter, Permit, ReplayGuard};
    use std::collections::HashMap;
    use std::io::Read;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use std::time::Duration;
    use tauri::{AppHandle, Emitter};

    const REPLY_TIMEOUT: Duration = Duration::from_secs(150);

    #[derive(Clone, Serialize)]
    struct RequestEvent {
        id: u64,
        body: String,
    }

    struct Running {
        server: Arc<tiny_http::Server>,
        key: Arc<Mutex<[u8; 32]>>,
    }

    /// Requests handled at the same time. A phone syncs one request at a time; this only limits floods.
    const MAX_PARALLEL: usize = 4;

    pub struct SyncState {
        running: Mutex<Option<Running>>,
        pending: Arc<Mutex<HashMap<u64, mpsc::Sender<String>>>>,
        next_id: Arc<AtomicU64>,
        replay: Arc<ReplayGuard>,
        slots: Arc<Limiter>,
    }

    impl Default for SyncState {
        fn default() -> Self {
            Self {
                running: Mutex::new(None),
                pending: Arc::default(),
                next_id: Arc::default(),
                replay: Arc::new(ReplayGuard::new(MAX_SKEW_MS)),
                slots: Limiter::new(MAX_PARALLEL),
            }
        }
    }

    #[derive(Serialize)]
    pub struct ServerInfo {
        addresses: Vec<String>,
        port: u16,
    }

    pub fn local_addresses() -> Vec<String> {
        let mut out: Vec<String> = local_ip_address::list_afinet_netifas()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(_, ip)| match ip {
                std::net::IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => Some(v4.to_string()),
                _ => None,
            })
            .collect();
        out.sort();
        out.dedup();
        out
    }

    pub fn start(app: AppHandle, state: &SyncState, code: &str) -> Result<ServerInfo, String> {
        let key = derive_key(code);
        let mut running = state.running.lock().unwrap();
        if let Some(r) = running.as_ref() {
            *r.key.lock().unwrap() = key;
        } else {
            let server = tiny_http::Server::http(("0.0.0.0", PORT)).map_err(|e| {
                format!("Couldn't open port {PORT} for phone sync. Is another copy of Canvas Notes running? ({e})")
            })?;
            let server = Arc::new(server);
            let key = Arc::new(Mutex::new(key));
            let (srv, k, pending, next_id) = (server.clone(), key.clone(), state.pending.clone(), state.next_id.clone());
            let (replay, slots) = (state.replay.clone(), state.slots.clone());
            thread::spawn(move || {
                for req in srv.incoming_requests() {
                    let Some(permit) = Limiter::try_acquire(&slots) else {
                        respond_text(req, 429, "Too many requests");
                        continue;
                    };
                    let key = *k.lock().unwrap();
                    let (app, pending, next_id, replay) = (app.clone(), pending.clone(), next_id.clone(), replay.clone());
                    thread::spawn(move || {
                        let _permit: Permit = permit;
                        handle(&app, req, key, &pending, &next_id, &replay)
                    });
                }
            });
            *running = Some(Running { server, key });
        }
        Ok(ServerInfo { addresses: local_addresses(), port: PORT })
    }

    pub fn stop(state: &SyncState) {
        if let Some(r) = state.running.lock().unwrap().take() {
            r.server.unblock();
        }
        state.pending.lock().unwrap().clear();
    }

    pub fn reply(state: &SyncState, id: u64, body: String) {
        if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(body);
        }
    }

    fn respond_text(req: tiny_http::Request, status: u16, text: &str) {
        let _ = req.respond(tiny_http::Response::from_string(text).with_status_code(status));
    }

    fn handle(
        app: &AppHandle,
        mut req: tiny_http::Request,
        key: [u8; 32],
        pending: &Mutex<HashMap<u64, mpsc::Sender<String>>>,
        next_id: &AtomicU64,
        replay: &ReplayGuard,
    ) {
        if req.method() != &tiny_http::Method::Post || req.url() != "/v1" {
            return respond_text(req, 404, "Canvas Notes sync");
        }
        let mut buf = Vec::new();
        if req.as_reader().take(MAX_BODY + 1).read_to_end(&mut buf).is_err() || buf.len() as u64 > MAX_BODY {
            return respond_text(req, 413, "Too large");
        }
        let body = match open(&key, &buf) {
            Ok(b) => b,
            Err(OpenError::Stale) => return respond_text(req, 408, "Clock difference too large"),
            Err(OpenError::BadKey) => return respond_text(req, 401, "Wrong pairing code"),
        };
        // Authenticated, so the nonce is genuine: a repeat is a captured message being sent again.
        if !replay.first_time(&buf[..12], now_ms()) {
            return respond_text(req, 409, "Repeated request");
        }

        let id = next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        pending.lock().unwrap().insert(id, tx);
        if app.emit("sync://request", RequestEvent { id, body }).is_err() {
            pending.lock().unwrap().remove(&id);
            return respond_text(req, 500, "UI unavailable");
        }
        match rx.recv_timeout(REPLY_TIMEOUT) {
            Ok(reply) => match seal(&key, reply) {
                Ok(bytes) => {
                    let _ = req.respond(tiny_http::Response::from_data(bytes).with_status_code(200));
                }
                Err(e) => respond_text(req, 500, &e),
            },
            Err(_) => {
                pending.lock().unwrap().remove(&id);
                respond_text(req, 504, "The laptop app didn't answer in time");
            }
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use server::SyncState;

/// On phones the server side is never used; this keeps the command list identical.
#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Default)]
pub struct SyncState;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn sync_server_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
    code: String,
) -> Result<server::ServerInfo, String> {
    server::start(app, &state, &code)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn sync_server_start(code: String) -> Result<(), String> {
    let _ = code;
    Err("The sync service runs on the laptop app.".into())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn sync_server_stop(state: tauri::State<'_, SyncState>) {
    server::stop(&state);
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn sync_server_stop() {}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn sync_server_reply(state: tauri::State<'_, SyncState>, id: u64, body: String) {
    server::reply(&state, id, body);
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn sync_server_reply(id: u64, body: String) {
    let _ = (id, body);
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn sync_local_addresses() -> Vec<String> {
    server::local_addresses()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn sync_local_addresses() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_and_open_round_trip() {
        let k = derive_key("ABCD-EFGH-2345");
        let sealed = seal(&k, "hello".into()).unwrap();
        assert_eq!(open(&k, &sealed).ok().as_deref(), Some("hello"));
    }

    #[test]
    fn code_formatting_does_not_matter() {
        assert_eq!(derive_key("abcd-efgh 2345"), derive_key("ABCDEFGH2345"));
    }

    #[test]
    fn wrong_code_is_rejected() {
        let sealed = seal(&derive_key("AAAA-BBBB"), "secret".into()).unwrap();
        assert!(matches!(open(&derive_key("AAAA-BBBC"), &sealed), Err(OpenError::BadKey)));
    }

    #[test]
    fn tampering_is_rejected() {
        let k = derive_key("AAAA-BBBB");
        let mut sealed = seal(&k, "secret".into()).unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert!(matches!(open(&k, &sealed), Err(OpenError::BadKey)));
    }
}
