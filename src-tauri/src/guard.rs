//! Defences around the sync transport that don't depend on Tauri, so they can be unit tested:
//! which addresses the phone may talk to, replay protection and a cap on parallel requests.

// The server side (replay guard, limiter) only exists on the laptop.
#![cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::sync::PORT;

/// The only places the app may send a sync request: a laptop on the local network, on the sync port.
/// The UI passes the address in, so it is checked here, in Rust, rather than trusted.
pub fn check_peer_url(url: &str) -> Result<(), String> {
    let bad = || "That isn't a local network address. Use the laptop's address shown in its Sync panel, like 192.168.1.20.".to_string();
    let rest = url.strip_prefix("http://").ok_or_else(bad)?;
    let (authority, path) = rest.split_once('/').ok_or_else(bad)?;
    if path != "v1" || authority.is_empty() || authority.contains('@') || authority.chars().any(|c| c.is_whitespace()) {
        return Err(bad());
    }
    let (host, port) = authority.rsplit_once(':').ok_or_else(bad)?;
    if port.parse::<u16>().ok() != Some(PORT) {
        return Err(bad());
    }
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        return if ip.is_private() || ip.is_loopback() || ip.is_link_local() { Ok(()) } else { Err(bad()) };
    }
    // A name on the local network (mDNS), e.g. my-laptop.local.
    let is_local_name = host.len() <= 253
        && host.to_ascii_lowercase().ends_with(".local")
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
    if is_local_name {
        Ok(())
    } else {
        Err(bad())
    }
}

/// Ids made by the app are letters, digits, `-` and `_` only: nothing that could change a path or a URL.
fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub const WIDGET_MIN: (f64, f64) = (180.0, 120.0);
pub const WIDGET_MAX: (f64, f64) = (1600.0, 1200.0);

/// A widget window's label must be exactly `w-<page>-<box or "page">`, built from safe ids. The UI asks for windows
/// by name, so the name is checked here: a webview can't open a window with some other label or address.
pub fn check_widget(id: &str, page_id: &str, block_id: Option<&str>) -> Result<(), String> {
    let bad = || "That isn't a valid widget.".to_string();
    if !safe_id(page_id) || block_id.is_some_and(|b| !safe_id(b)) {
        return Err(bad());
    }
    if id != format!("w-{page_id}-{}", block_id.unwrap_or("page")) {
        return Err(bad());
    }
    Ok(())
}

/// A widget label with no page or box attached (for closing or restacking one that exists).
pub fn check_widget_label(id: &str) -> Result<(), String> {
    match id.strip_prefix("w-") {
        Some(rest) if !rest.is_empty() && rest.len() <= 164 && rest.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') => Ok(()),
        _ => Err("That isn't a valid widget.".to_string()),
    }
}

/// Size within sensible limits; NaN and infinities become the minimum.
pub fn clamp_size(w: f64, h: f64) -> (f64, f64) {
    let fix = |v: f64, lo: f64, hi: f64| if v.is_finite() { v.clamp(lo, hi) } else { lo };
    (fix(w, WIDGET_MIN.0, WIDGET_MAX.0), fix(h, WIDGET_MIN.1, WIDGET_MAX.1))
}

/// Remembers the nonces of recently accepted messages so a captured request can't be replayed
/// while its timestamp is still inside the allowed clock difference.
pub struct ReplayGuard {
    seen: Mutex<HashMap<Vec<u8>, i64>>,
    window_ms: i64,
}

const MAX_REMEMBERED: usize = 50_000;

impl ReplayGuard {
    pub fn new(window_ms: i64) -> Self {
        Self { seen: Mutex::new(HashMap::new()), window_ms }
    }

    /// True the first time a nonce is seen inside the window. When the table is full it refuses (fails closed).
    pub fn first_time(&self, nonce: &[u8], now_ms: i64) -> bool {
        let mut seen = self.seen.lock().unwrap();
        // A message is only accepted for `window_ms` either side of now, so its nonce only matters for twice that.
        let horizon = now_ms - 2 * self.window_ms;
        seen.retain(|_, t| *t >= horizon);
        if seen.contains_key(nonce) || seen.len() >= MAX_REMEMBERED {
            return false;
        }
        seen.insert(nonce.to_vec(), now_ms);
        true
    }
}

/// Caps how many requests are handled at once, so a flood can't pile up threads and memory.
pub struct Limiter {
    active: AtomicUsize,
    max: usize,
}

pub struct Permit(Arc<Limiter>);

impl Limiter {
    pub fn new(max: usize) -> Arc<Self> {
        Arc::new(Self { active: AtomicUsize::new(0), max })
    }

    pub fn try_acquire(this: &Arc<Self>) -> Option<Permit> {
        if this.active.fetch_add(1, Ordering::AcqRel) >= this.max {
            this.active.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        Some(Permit(this.clone()))
    }
}

impl Drop for Permit {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_laptop_on_the_local_network() {
        for url in ["http://192.168.1.20:47821/v1", "http://10.0.0.5:47821/v1", "http://172.16.4.2:47821/v1", "http://127.0.0.1:47821/v1", "http://my-laptop.local:47821/v1"] {
            assert!(check_peer_url(url).is_ok(), "{url}");
        }
    }

    #[test]
    fn refuses_everything_else() {
        for url in [
            "http://8.8.8.8:47821/v1",
            "http://example.com:47821/v1",
            "https://192.168.1.20:47821/v1",
            "http://192.168.1.20:80/v1",
            "http://192.168.1.20:47821/other",
            "http://192.168.1.20:47821/v1/x",
            "http://user@192.168.1.20:47821/v1",
            "http://192.168.1.20@evil.com:47821/v1",
            "http://evil.local.example.com:47821/v1",
            "http://169.254.169.254.evil.com:47821/v1",
            "file:///etc/passwd",
            "",
        ] {
            assert!(check_peer_url(url).is_err(), "{url}");
        }
    }

    #[test]
    fn widget_names_must_match_their_page_and_box() {
        assert!(check_widget("w-p1-b1", "p1", Some("b1")).is_ok());
        assert!(check_widget("w-p1-page", "p1", None).is_ok());
        for (id, page, block) in [
            ("main", "p1", None),
            ("w-p1-b1", "p1", None),
            ("w-p1-b1", "p2", Some("b1")),
            ("w-../x-page", "../x", None),
            ("w-p1-a/b", "p1", Some("a/b")),
            ("w--page", "", None),
            ("w-p1-b1?x=1", "p1", Some("b1?x=1")),
        ] {
            assert!(check_widget(id, page, block).is_err(), "{id}");
        }
        assert!(check_widget_label("w-p1-b1").is_ok());
        for bad in ["main", "w-", "w-a b", "w-../x", "W-a"] {
            assert!(check_widget_label(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn widget_sizes_are_kept_in_range() {
        assert_eq!(clamp_size(10.0, 99999.0), (180.0, 1200.0));
        assert_eq!(clamp_size(f64::NAN, f64::INFINITY), (180.0, 120.0));
        assert_eq!(clamp_size(300.0, 200.0), (300.0, 200.0));
    }

    #[test]
    fn a_nonce_is_accepted_once() {
        let g = ReplayGuard::new(1000);
        assert!(g.first_time(b"aaaa", 5_000));
        assert!(!g.first_time(b"aaaa", 5_100));
        assert!(g.first_time(b"bbbb", 5_100));
    }

    #[test]
    fn old_nonces_are_forgotten() {
        let g = ReplayGuard::new(1000);
        assert!(g.first_time(b"aaaa", 0));
        // Far enough later that a message with that timestamp would be refused as stale anyway.
        assert!(g.first_time(b"aaaa", 10_000));
    }

    #[test]
    fn only_so_many_requests_run_at_once() {
        let l = Limiter::new(2);
        let a = Limiter::try_acquire(&l);
        let b = Limiter::try_acquire(&l);
        assert!(a.is_some() && b.is_some());
        assert!(Limiter::try_acquire(&l).is_none());
        drop(a);
        assert!(Limiter::try_acquire(&l).is_some());
    }
}
