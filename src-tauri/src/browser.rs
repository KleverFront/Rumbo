use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const IMPORT_SCHEME: &str = "rumbo-import";
const INJECT_JS: &str = include_str!("browser_inject.js");

/// Offer sent by the injected button; every field is untrusted page data.
#[derive(Deserialize)]
struct RawOffer {
    title: Option<String>,
    company: Option<String>,
    location: Option<String>,
    url: Option<String>,
    description: Option<String>,
    posted_at: Option<String>,
}

#[derive(Clone, Serialize)]
struct ImportedOffer {
    portal: String,
    title: String,
    company: Option<String>,
    location: Option<String>,
    url: Option<String>,
    description: String,
    posted_at: Option<String>,
}

/// Turns the query into a path segment: lowercase words joined by '-', no '/', '?' or '#'.
fn slug(q: &str) -> String {
    q.to_lowercase()
        .split_whitespace()
        .map(|w| w.chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn portal_url(portal: &str, query: Option<&str>) -> Result<Url, String> {
    let q = query.map(str::trim).filter(|q| !q.is_empty());
    let raw = match (portal, q) {
        ("indeed", Some(q)) => {
            let mut url = Url::parse("https://ec.indeed.com/jobs").unwrap();
            url.query_pairs_mut().append_pair("q", q);
            return Ok(url);
        }
        ("indeed", None) => "https://ec.indeed.com/".to_string(),
        ("computrabajo", Some(q)) if !slug(q).is_empty() => {
            format!("https://ec.computrabajo.com/trabajo-de-{}", slug(q))
        }
        ("computrabajo", _) => "https://ec.computrabajo.com/".to_string(),
        ("multitrabajos", Some(q)) if !slug(q).is_empty() => {
            format!("https://www.multitrabajos.com/empleos-busqueda-{}.html", slug(q))
        }
        ("multitrabajos", _) => "https://www.multitrabajos.com/".to_string(),
        _ => return Err(format!("unknown portal: {portal}")),
    };
    Url::parse(&raw).map_err(|e| e.to_string())
}

/// Trims, drops empty values and caps the length in chars.
fn clean(value: Option<String>, max: usize) -> Option<String> {
    let v = value?.trim().chars().take(max).collect::<String>();
    (!v.is_empty()).then_some(v)
}

fn parse_offer(portal: &str, url: &Url) -> Option<ImportedOffer> {
    let data = url.query_pairs().find(|(k, _)| k == "data")?.1;
    let raw: RawOffer = serde_json::from_str(&data).ok()?;
    // Only http(s) links are kept, so a page cannot store a javascript: or file: URL.
    let link = clean(raw.url, 2_000).filter(|u| {
        Url::parse(u).is_ok_and(|p| matches!(p.scheme(), "http" | "https"))
    });
    Some(ImportedOffer {
        portal: portal.to_string(),
        title: clean(raw.title, 300)?,
        company: clean(raw.company, 300),
        location: clean(raw.location, 300),
        url: link,
        description: clean(raw.description, 50_000)?,
        posted_at: clean(raw.posted_at, 40),
    })
}

/// Opens (or focuses and navigates) the window of a whitelisted job portal.
/// The external page gets no Tauri IPC; the injected button reports back through a
/// `rumbo-import://` navigation that is cancelled here and forwarded to the main window.
#[tauri::command]
pub async fn browser_open(app: AppHandle, portal: String, query: Option<String>) -> Result<(), String> {
    let url = portal_url(&portal, query.as_deref())?;
    if let Some(window) = app.get_webview_window(&portal) {
        window.navigate(url).map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let handle = app.clone();
    let label = portal.clone();
    WebviewWindowBuilder::new(&app, &portal, WebviewUrl::External(url))
        .title(format!("Rumbo · {portal}"))
        .inner_size(1200.0, 820.0)
        .initialization_script(INJECT_JS)
        .on_navigation(move |url| {
            if url.scheme() != IMPORT_SCHEME {
                return true;
            }
            match parse_offer(&label, url) {
                Some(offer) => {
                    let _ = handle.emit_to("main", "browser-import", offer);
                }
                None => eprintln!("browser: ignored invalid import from {label}"),
            }
            false
        })
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_whitelisted_urls() {
        assert_eq!(
            portal_url("indeed", Some("analista de datos")).unwrap().as_str(),
            "https://ec.indeed.com/jobs?q=analista+de+datos"
        );
        assert_eq!(
            portal_url("computrabajo", Some("Analista  Datos/x")).unwrap().as_str(),
            "https://ec.computrabajo.com/trabajo-de-analista-datosx"
        );
        assert_eq!(
            portal_url("multitrabajos", None).unwrap().as_str(),
            "https://www.multitrabajos.com/"
        );
        assert!(portal_url("evil", None).is_err());
    }

    #[test]
    fn validates_import_payload() {
        let json = r#"{"title":"  Dev ","description":"Hacer cosas","url":"javascript:alert(1)"}"#;
        let mut url = Url::parse("rumbo-import://job").unwrap();
        url.query_pairs_mut().append_pair("data", json);
        let offer = parse_offer("indeed", &url).unwrap();
        assert_eq!(offer.title, "Dev");
        assert_eq!(offer.url, None);

        let mut bad = Url::parse("rumbo-import://job").unwrap();
        bad.query_pairs_mut().append_pair("data", r#"{"title":"Dev"}"#);
        assert!(parse_offer("indeed", &bad).is_none());
    }
}
