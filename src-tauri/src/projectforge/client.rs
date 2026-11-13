//! HTTP-Zugriff auf ProjectForge (REST-API mit persönlichem Schlüssel).

use std::collections::BTreeSet;
use std::time::Duration;

use chrono::{Days, NaiveDate, NaiveDateTime};
use reqwest::header::{ACCEPT, AUTHORIZATION};
use serde::de::DeserializeOwned;

use super::{
    BookableTask, CostTypes, ListResponse, Row, convert_row, month_bounds, month_key,
    months_to_fetch,
};
use crate::storage::projectforge::{CachedMonth, FetchCache};

/// Höchstzahl Zeilen je Anfrage; liefert ProjectForge weniger als vorhanden,
/// wird der Zeitraum geteilt.
pub const MAX_ROWS: usize = 5000;

/// Zugangsdaten: Server-Adresse, User-ID (Zahl) und Schlüssel für Rest-Clients.
pub struct Access {
    pub base_url: String,
    pub user_id: i64,
    pub token: String,
}

pub struct Client {
    base: String,
    auth: String,
    http: reqwest::Client,
}

/// „projectforge.example.com/“ → „https://projectforge.example.com“.
pub fn normalize_base_url(url: &str) -> Result<String, String> {
    let url = url.trim().trim_end_matches('/');
    if url.is_empty() {
        return Err("Bitte die Adresse des ProjectForge-Servers angeben.".into());
    }
    let url = if url.contains("://") {
        url.to_string()
    } else {
        format!("https://{url}")
    };
    if !(url.starts_with("https://") || url.starts_with("http://"))
        || url.contains(char::is_whitespace)
    {
        return Err(format!("Ungültige Server-Adresse „{url}“."));
    }
    Ok(url)
}

impl Client {
    pub fn new(access: &Access) -> Result<Self, String> {
        // TLS mit „ring“; Zertifikate prüft das Betriebssystem (auch firmeneigene).
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            // Eine abgelehnte Anmeldung leitet zur Login-Seite weiter – nicht folgen.
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(180))
            .user_agent(concat!("BillingTracker/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| format!("HTTP-Client konnte nicht erstellt werden: {e}"))?;
        Ok(Self {
            base: normalize_base_url(&access.base_url)?,
            auth: format!("Bearer {}:{}", access.user_id, access.token.trim()),
            http,
        })
    }

    async fn call<T: DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
        what: &str,
    ) -> Result<T, String> {
        let response = request
            .header(AUTHORIZATION, &self.auth)
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(|e| self.connection_error(&e))?;
        let status = response.status();
        let request_id = response
            .headers()
            .get("X-Request-Id")
            .and_then(|v| v.to_str().ok())
            .map(|id| format!(" (X-Request-Id {id})"))
            .unwrap_or_default();
        if status.is_redirection() {
            return Err(rejected());
        }
        let body = response
            .text()
            .await
            .map_err(|e| format!("Antwort von ProjectForge ({what}) unvollständig: {e}"))?;
        if !status.is_success() {
            let detail: String = body.trim().chars().take(300).collect();
            let detail = if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            };
            return Err(format!(
                "ProjectForge antwortet bei {what} mit HTTP {}{detail}{request_id}",
                status.as_u16()
            ));
        }
        if body.trim_start().starts_with('<') {
            // Login-Seite statt Daten
            return Err(rejected());
        }
        serde_json::from_str(&body)
            .map_err(|e| format!("Antwort von ProjectForge ({what}) nicht lesbar: {e}{request_id}"))
    }

    fn connection_error(&self, error: &reqwest::Error) -> String {
        let mut message = error.to_string();
        let mut source = std::error::Error::source(error);
        while let Some(inner) = source {
            message.push_str(&format!(" – {inner}"));
            source = inner.source();
        }
        if error.is_timeout() {
            format!("Zeitüberschreitung bei der Verbindung zu {}.", self.base)
        } else {
            format!(
                "Keine Verbindung zu {} ({message}). Netzwerk bzw. VPN und Adresse prüfen.",
                self.base
            )
        }
    }

    /// Tasks, auf die der Zugang buchen darf – mit Kostenstellen und Kostenarten.
    pub async fn bookable_tasks(&self) -> Result<Vec<BookableTask>, String> {
        self.call(
            self.http.get(format!("{}/rs/bookableTasks", self.base)),
            "/rs/bookableTasks",
        )
        .await
    }

    async fn list(&self, from: NaiveDate, to: NaiveDate) -> Result<ListResponse, String> {
        let body = serde_json::json!({
            "entries": [{"field": "period", "value": {
                "from": from.format("%Y-%m-%d").to_string(),
                "to": to.format("%Y-%m-%d").to_string(),
            }}],
            "maxRows": MAX_ROWS,
            "sortProperties": [{"property": "startTime", "sortOrder": "ASCENDING"}],
        });
        self.call(
            self.http
                .put(format!("{}/rs/timesheet/list?doNotStore=true", self.base))
                .json(&body),
            "/rs/timesheet/list",
        )
        .await
    }

    /// Alle lesbaren Buchungen vom `from` bis `to` (Kalendertage, einschließlich).
    /// Kürzt ProjectForge die Liste, wird der Zeitraum halbiert.
    pub async fn timesheets(&self, from: NaiveDate, to: NaiveDate) -> Result<Vec<Row>, String> {
        let mut pending = vec![(from, to)];
        let mut rows = Vec::new();
        while let Some((from, to)) = pending.pop() {
            let response = self.list(from, to).await?;
            if !response.truncated() {
                rows.extend(response.result_set);
                continue;
            }
            if from >= to {
                return Err(format!(
                    "ProjectForge liefert für den {} nicht alle Buchungen (mehr als {MAX_ROWS}).",
                    from.format("%d.%m.%Y")
                ));
            }
            let mid = from + Days::new(((to - from).num_days() / 2) as u64);
            pending.push((mid + Days::new(1), to));
            pending.push((from, mid));
        }
        Ok(rows)
    }
}

fn rejected() -> String {
    "ProjectForge hat die Anmeldung abgelehnt (Weiterleitung zur Anmeldeseite). User-ID und Schlüssel prüfen."
        .into()
}

/// Ruft fehlende und noch offene Monate ab `from` bis heute (`now`) ab und
/// aktualisiert den Zwischenspeicher. `full` = alle Monate neu.
pub async fn refresh(
    client: &Client,
    mut cache: FetchCache,
    from: NaiveDate,
    now: NaiveDateTime,
    full: bool,
) -> Result<FetchCache, String> {
    let today = now.date();
    let mut types = CostTypes::from_bookable(&client.bookable_tasks().await?);
    types.merge_missing(&cache.cost_types);
    for month in months_to_fetch(from, today, &cache.fetched_months(), full) {
        let (first, last) = month_bounds(month);
        let rows = client.timesheets(first, last.min(today)).await?;
        let mut unknown = BTreeSet::new();
        let entries = rows
            .iter()
            .filter_map(|row| convert_row(row, &types, &mut unknown))
            // über Mitternacht am Monatswechsel: gehört zum Monat des Beginns
            .filter(|e| e.date >= first && e.date <= last)
            .collect();
        cache.months.insert(
            month_key(month),
            CachedMonth {
                fetched_at: now,
                entries,
                unknown_kinds: unknown,
            },
        );
    }
    cache.cost_types = types;
    cache.fetched_at = Some(now);
    Ok(cache)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// Eine empfangene Anfrage an den Test-Server.
    #[derive(Debug, Clone)]
    pub struct Request {
        pub method: String,
        pub path: String,
        pub authorization: String,
        pub body: String,
    }

    /// Kleiner HTTP-Server für Tests: beantwortet Anfragen mit `respond`
    /// (Status, Text) und merkt sich alle Anfragen.
    pub fn serve(
        respond: impl Fn(&Request) -> (u16, String) + Send + Sync + 'static,
    ) -> (String, Arc<Mutex<Vec<Request>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let log = Arc::new(Mutex::new(Vec::new()));
        let seen = log.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let mut parts = line.split_whitespace();
                let (method, path) = (
                    parts.next().unwrap_or_default().to_string(),
                    parts.next().unwrap_or_default().to_string(),
                );
                let (mut length, mut authorization) = (0, String::new());
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    let header = header.trim_end();
                    if header.is_empty() {
                        break;
                    }
                    let (name, value) = header.split_once(':').unwrap_or((header, ""));
                    match name.to_ascii_lowercase().as_str() {
                        "content-length" => length = value.trim().parse().unwrap_or(0),
                        "authorization" => authorization = value.trim().to_string(),
                        _ => {}
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let request = Request {
                    method,
                    path,
                    authorization,
                    body: String::from_utf8_lossy(&body).into_owned(),
                };
                let (status, text) = respond(&request);
                seen.lock().unwrap().push(request);
                let extra = if status == 302 {
                    "Location: /login\r\n"
                } else {
                    ""
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nX-Request-Id: req-1\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{text}",
                    text.len()
                );
            }
        });
        (url, log)
    }

    pub fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    pub const BOOKABLE: &str = r#"[{"id":1,"name":"P100 Lager-App","path":[],"kost2":[
        {"id":501,"workFraction":1.0,"formattedNumber":"5.100.00.04","kost2Art":{"id":4,"name":"Delivery (billable)"}},
        {"id":502,"workFraction":0.0,"formattedNumber":"5.100.00.05","kost2Art":{"id":5,"name":"Travel (billable)"}}]}]"#;

    /// Eine Zeile wie von `/rs/timesheet/list` (fiktive Daten).
    pub fn row_json(id: i64, person: &str, start: &str, hours: f64, kind: i64) -> String {
        format!(
            r#"{{"timesheet":{{"id":{id},"task":{{"id":1,"title":"P100 Lager-App","displayName":"P100 Lager-App (#1)"}},
              "user":{{"id":42,"displayName":"{person}"}},"location":"Büro",
              "kost2":{{"id":50{kind},"displayName":"5.100.00.0{kind}: x - Lager-App","endziffer":{kind}}},
              "startTime":"{start}"}},"id":{id},"durationMillis":{}}}"#,
            (hours * 3_600_000.0) as i64
        )
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    fn client(url: &str) -> Client {
        Client::new(&Access {
            base_url: url.into(),
            user_id: 42,
            token: " geheim ".into(),
        })
        .unwrap()
    }

    /// Zeitraum aus dem Filter einer Anfrage.
    pub fn period(request: &Request) -> (String, String) {
        let body: serde_json::Value = serde_json::from_str(&request.body).unwrap();
        let value = &body["entries"][0]["value"];
        (
            value["from"].as_str().unwrap().to_string(),
            value["to"].as_str().unwrap().to_string(),
        )
    }

    #[test]
    fn normalizes_server_addresses() {
        assert_eq!(
            normalize_base_url(" pf.example.com/ ").unwrap(),
            "https://pf.example.com"
        );
        assert_eq!(
            normalize_base_url("http://localhost:8080").unwrap(),
            "http://localhost:8080"
        );
        assert!(normalize_base_url("").is_err());
        assert!(normalize_base_url("ftp://pf").is_err());
        assert!(normalize_base_url("pf example").is_err());
    }

    #[test]
    fn lists_timesheets_and_splits_truncated_periods() {
        // Für mehr als 10 Tage meldet der Server „gekürzt“ → der Zeitraum wird geteilt.
        let (url, log) = serve(|request| {
            let (from, to) = period(request);
            let (from, to): (NaiveDate, NaiveDate) = (from.parse().unwrap(), to.parse().unwrap());
            let rows: Vec<String> = from
                .iter_days()
                .take_while(|day| *day <= to)
                .map(|day| {
                    row_json(
                        day.format("%m%d").to_string().parse().unwrap(),
                        "Erika Mustermann",
                        &format!("{day}T08:00:00.000Z"),
                        8.0,
                        4,
                    )
                })
                .collect();
            let truncated = (to - from).num_days() >= 10;
            let listed = if truncated {
                String::new()
            } else {
                rows.join(",")
            };
            (
                200,
                format!(
                    r#"{{"resultSet":[{listed}],"totalSize":{},"resultSetTruncated":{truncated}}}"#,
                    rows.len()
                ),
            )
        });
        let rows = runtime()
            .block_on(client(&url).timesheets(d(11, 1), d(11, 30)))
            .unwrap();
        assert_eq!(rows.len(), 30);
        let requests = log.lock().unwrap();
        let first = &requests[0];
        assert_eq!(first.method, "PUT");
        assert_eq!(first.path, "/rs/timesheet/list?doNotStore=true");
        assert_eq!(first.authorization, "Bearer 42:geheim");
        let body: serde_json::Value = serde_json::from_str(&first.body).unwrap();
        assert_eq!(body["entries"][0]["field"], "period");
        assert_eq!(body["maxRows"], MAX_ROWS);
        assert_eq!(period(first), ("2026-11-01".into(), "2026-11-30".into()));
        // 1.–30. → 1.–15. → 1.–8. + 9.–15. → 16.–30. → 16.–23. + 24.–30.
        let periods: Vec<_> = requests.iter().map(period).collect();
        assert!(periods.contains(&("2026-11-01".into(), "2026-11-08".into())));
        assert!(periods.contains(&("2026-11-24".into(), "2026-11-30".into())));
    }

    #[test]
    fn reports_rejected_login_and_server_errors() {
        let rt = runtime();
        let (url, _) = serve(|_| (302, String::new()));
        let error = rt.block_on(client(&url).bookable_tasks()).unwrap_err();
        assert!(error.contains("Anmeldung abgelehnt"), "{error}");

        let (url, _) = serve(|_| (200, "<html>Login</html>".into()));
        let error = rt.block_on(client(&url).bookable_tasks()).unwrap_err();
        assert!(error.contains("Anmeldung abgelehnt"), "{error}");

        let (url, _) = serve(|_| (500, "Internal error".into()));
        let error = rt
            .block_on(client(&url).timesheets(d(11, 1), d(11, 2)))
            .unwrap_err();
        assert_eq!(
            error,
            "ProjectForge antwortet bei /rs/timesheet/list mit HTTP 500: Internal error (X-Request-Id req-1)"
        );

        let (url, _) = serve(|_| (200, "{kaputt".into()));
        let error = rt.block_on(client(&url).bookable_tasks()).unwrap_err();
        assert!(
            error.starts_with("Antwort von ProjectForge (/rs/bookableTasks) nicht lesbar"),
            "{error}"
        );

        // ein Tag mit zu vielen Buchungen
        let (url, _) = serve(|_| (200, r#"{"resultSet":[],"resultSetTruncated":true}"#.into()));
        let error = rt
            .block_on(client(&url).timesheets(d(11, 1), d(11, 1)))
            .unwrap_err();
        assert!(error.contains("01.11.2026 nicht alle Buchungen"), "{error}");

        // kein Server
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let error = rt
            .block_on(client(&format!("http://127.0.0.1:{port}")).bookable_tasks())
            .unwrap_err();
        assert!(
            error.starts_with("Keine Verbindung zu http://127.0.0.1"),
            "{error}"
        );
    }

    #[test]
    fn refresh_fetches_open_months_and_keeps_closed_ones() {
        let (url, log) = serve(|request| {
            if request.path == "/rs/bookableTasks" {
                return (200, BOOKABLE.into());
            }
            let (from, _) = period(request);
            let rows = match from.as_str() {
                // Oktober: eine Buchung am 31.10. über Mitternacht, kommt auch im November
                "2026-10-01" => vec![row_json(
                    1,
                    "Erika Mustermann",
                    "2026-10-31T22:00:00.000Z",
                    2.0,
                    4,
                )],
                "2026-11-01" => vec![
                    row_json(1, "Erika Mustermann", "2026-10-31T22:00:00.000Z", 2.0, 4),
                    row_json(2, "Max Mustermann", "2026-11-02T07:00:00.000Z", 1.0, 5),
                    row_json(3, "Max Mustermann", "2026-11-02T09:00:00.000Z", 1.0, 9),
                ],
                _ => vec![],
            };
            (200, format!(r#"{{"resultSet":[{}]}}"#, rows.join(",")))
        });
        let rt = runtime();
        let now = d(11, 13).and_hms_opt(9, 30, 0).unwrap();
        let cache = rt
            .block_on(refresh(
                &client(&url),
                FetchCache::default(),
                d(10, 1),
                now,
                false,
            ))
            .unwrap();
        assert_eq!(cache.fetched_at, Some(now));
        assert_eq!(
            cache.months.keys().collect::<Vec<_>>(),
            ["2026-10", "2026-11"]
        );
        // 31.10. 23:00 MEZ gehört zum Oktober (nicht doppelt im November)
        assert_eq!(cache.months["2026-10"].entries.len(), 1);
        let november = &cache.months["2026-11"];
        assert_eq!(november.entries.len(), 2);
        assert_eq!(november.entries[0].kost2art, "Travel (billable)");
        assert_eq!(november.entries[0].mult, 0.0);
        assert_eq!(november.unknown_kinds, BTreeSet::from(["09 x".to_string()]));
        assert_eq!(cache.entries().len(), 3);
        // November nur bis heute abgefragt
        let periods: Vec<_> = log.lock().unwrap().iter().skip(1).map(period).collect();
        assert_eq!(
            periods,
            [
                ("2026-10-01".to_string(), "2026-10-31".to_string()),
                ("2026-11-01".to_string(), "2026-11-13".to_string())
            ]
        );

        // Ende Dezember: Oktober abgeschlossen → nur noch November und Dezember
        log.lock().unwrap().clear();
        let later = NaiveDate::from_ymd_opt(2026, 12, 20)
            .unwrap()
            .and_hms_opt(8, 0, 0)
            .unwrap();
        let mut old = cache.clone();
        old.months.get_mut("2026-10").unwrap().fetched_at = d(11, 13).and_hms_opt(8, 0, 0).unwrap();
        let cache = rt
            .block_on(refresh(&client(&url), old, d(10, 1), later, false))
            .unwrap();
        let periods: Vec<_> = log.lock().unwrap().iter().skip(1).map(period).collect();
        assert_eq!(periods.len(), 2);
        assert_eq!(periods[0].0, "2026-11-01");
        assert_eq!(cache.months["2026-10"].entries.len(), 1);
        assert_eq!(cache.cost_types.kinds.len(), 2);
    }
}
