//! Erzeugt einen fiktiven ProjectForge-Export für Tests und zum Ausprobieren:
//! `sample-data/Beispiel-Export_2026-10-31.xlsx` (passend zu `sample-data/beispiel-projekt.json`).
//!
//! Alle Namen, Projekte und Werte sind ausgedacht.
//!
//! ```bash
//! cd src-tauri && cargo run --example generate_sample_export
//! ```

use std::path::PathBuf;

use chrono::{Datelike, NaiveDate, Weekday};
use rust_xlsxwriter::{DocProperties, ExcelDateTime, Format, Workbook, Worksheet, XlsxError};

const START: (i32, u32, u32) = (2026, 1, 1);
const CUTOFF: (i32, u32, u32) = (2026, 10, 30);

/// Gesetzliche Feiertage Hessen 2026 bis zum Stichtag (Ostersonntag = 5. April).
const HOLIDAYS: [(u32, u32); 8] = [
    (1, 1),  // Neujahr
    (4, 3),  // Karfreitag
    (4, 6),  // Ostermontag
    (5, 1),  // Tag der Arbeit
    (5, 14), // Christi Himmelfahrt
    (5, 25), // Pfingstmontag
    (6, 4),  // Fronleichnam
    (10, 3), // Tag der Deutschen Einheit (Samstag)
];

const ERIKA: &str = "Erika Mustermann";
const MAX: &str = "Max Mustermann";
const JONAS: &str = "Jonas Beispiel"; // nicht im Projektteam
const LENA: &str = "Lena Beispiel"; // nur Januar/Februar im Projektteam
const KARL: &str = "Karl Beispiel"; // Geschäftsführung, Rolle „darf buchen“

/// Eine Zeile im Export-Layout (Spalten wie `ColumnMapping::default`).
struct Row {
    user: &'static str,
    date: NaiveDate,
    hours: f64,
    mult: Option<f64>,
    element: &'static str,
    kost2art: &'static str,
    task: &'static str,
    location: &'static str,
}

fn d(m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, m, day).unwrap()
}

fn in_range(date: NaiveDate, from: (u32, u32), to: (u32, u32)) -> bool {
    date >= d(from.0, from.1) && date <= d(to.0, to.1)
}

fn absence(user: &'static str, date: NaiveDate, element: &'static str) -> Row {
    Row {
        user,
        date,
        hours: 8.0, // Personio liefert immer 8 h/Tag
        mult: None,
        element,
        kost2art: "",
        task: "",
        location: "",
    }
}

fn work(
    user: &'static str,
    date: NaiveDate,
    hours: f64,
    element: &'static str,
    kost2art: &'static str,
    task: &'static str,
    location: &'static str,
) -> Row {
    Row {
        user,
        date,
        hours,
        mult: None,
        element,
        kost2art,
        task,
        location,
    }
}

fn rows_for_day(date: NaiveDate, rows: &mut Vec<Row>) {
    const PROJECT: &str = "P100 Lager-App";
    const INTRANET: &str = "P200 Intranet";
    const INTERN: &str = "Z900 Intern";
    let weekday = date.weekday();

    // Wochenend-Buchungen (müssen in die Auswertung einfließen).
    if date == d(9, 12) {
        rows.push(work(
            ERIKA,
            date,
            4.0,
            PROJECT,
            "Delivery (billable)",
            "Go-live-Vorbereitung",
            "Home Office",
        ));
    }
    // Urlaub an einem Samstag (wird mitgezählt und in der App hervorgehoben).
    if date == d(7, 25) {
        rows.push(absence(MAX, date, "(Vacation)"));
    }
    if date == d(6, 14) {
        let mut on_call = work(
            MAX,
            date,
            3.0,
            PROJECT,
            "Delivery (billable)",
            "Rufbereitschaft",
            "Home Office",
        );
        on_call.mult = Some(0.0);
        rows.push(on_call);
    }
    if matches!(weekday, Weekday::Sat | Weekday::Sun)
        || HOLIDAYS.contains(&(date.month(), date.day()))
    {
        return;
    }

    // Erika: Entwicklung, freitags anteilig Sales bzw. am Quartalsende Key-User-Schulung.
    if in_range(date, (3, 9), (3, 13)) || in_range(date, (8, 3), (8, 14)) {
        rows.push(absence(ERIKA, date, "(Vacation)"));
    } else if in_range(date, (2, 16), (2, 17)) {
        rows.push(absence(ERIKA, date, "(Sick)"));
    } else if date == d(10, 20) {
        // Keine Buchung → „fehlende Buchung“ in der App
    } else if date == d(9, 16) {
        // Nur gut die Hälfte gebucht (4 von 7,5 h) → knapp über der 50-%-Schwelle
        rows.push(work(
            ERIKA,
            date,
            4.0,
            PROJECT,
            "Delivery (billable)",
            "Entwicklung",
            "Home Office",
        ));
    } else if date == d(5, 8) {
        // Halber Krankheitstag
        let mut half = absence(ERIKA, date, "(Sick)");
        half.hours = 4.0;
        rows.push(half);
        rows.push(work(
            ERIKA,
            date,
            4.0,
            PROJECT,
            "Delivery (billable)",
            "Entwicklung",
            "Home Office",
        ));
    } else if [d(3, 27), d(6, 26), d(9, 25)].contains(&date) {
        rows.push(work(
            ERIKA,
            date,
            6.5,
            PROJECT,
            "Delivery (billable)",
            "Entwicklung",
            "Home Office",
        ));
        rows.push(work(
            ERIKA,
            date,
            1.5,
            PROJECT,
            "Training (billable)",
            "Schulung Key-User",
            "Kunde vor Ort",
        ));
    } else if weekday == Weekday::Fri {
        rows.push(work(
            ERIKA,
            date,
            6.5,
            PROJECT,
            "Delivery (billable)",
            "Entwicklung",
            "Home Office",
        ));
        rows.push(work(
            ERIKA,
            date,
            1.5,
            PROJECT,
            "Sales",
            "Angebot Folgephase",
            "Home Office",
        ));
    } else {
        let hours = [8.0, 7.5, 8.5, 8.25][date.weekday().num_days_from_monday() as usize];
        rows.push(work(
            ERIKA,
            date,
            hours,
            PROJECT,
            "Delivery (billable)",
            "Entwicklung",
            "Büro",
        ));
    }

    // Max: erster Montag im Monat beim Kunden (inkl. Reisezeit), donnerstags Teammeeting.
    if in_range(date, (7, 20), (7, 31)) {
        rows.push(absence(MAX, date, "(Vacation)"));
    } else if in_range(date, (10, 12), (10, 14)) {
        rows.push(absence(MAX, date, "(Sick)"));
    } else if date == d(10, 22) {
        // Nur 2 von 6 h gebucht → „fehlende Buchung“
        rows.push(work(
            MAX,
            date,
            2.0,
            PROJECT,
            "Delivery (billable)",
            "Entwicklung",
            "Home Office",
        ));
    } else if weekday == Weekday::Mon && date.day() <= 7 {
        let mut travel = work(
            MAX,
            date,
            2.0,
            PROJECT,
            "Travel (billable)",
            "Anreise",
            "Kunde vor Ort",
        );
        travel.mult = Some(0.5);
        rows.push(travel);
        rows.push(work(
            MAX,
            date,
            6.0,
            PROJECT,
            "Delivery (billable)",
            "Workshop",
            "Kunde vor Ort",
        ));
    } else if weekday == Weekday::Thu {
        rows.push(work(
            MAX,
            date,
            7.0,
            PROJECT,
            "Delivery (billable)",
            "Entwicklung",
            "Home Office",
        ));
        rows.push(work(
            MAX,
            date,
            1.0,
            INTERN,
            "Internal",
            "Teammeeting",
            "Büro",
        ));
    } else {
        rows.push(work(
            MAX,
            date,
            8.0,
            PROJECT,
            "Delivery (billable)",
            "Entwicklung",
            "Home Office",
        ));
    }

    // Jonas: anderes Projekt, Mo–Do; am 01.10. ein Code-Review auf unser Projekt,
    // obwohl er nicht im Team ist (→ „außerhalb des Teams“, nicht abgerechnet).
    if date == d(10, 1) {
        rows.push(work(
            JONAS,
            date,
            5.0,
            INTRANET,
            "Delivery (billable)",
            "Entwicklung",
            "Büro",
        ));
        rows.push(work(
            JONAS,
            date,
            3.0,
            PROJECT,
            "Delivery (billable)",
            "Code-Review",
            "Büro",
        ));
    } else if weekday != Weekday::Fri {
        rows.push(work(
            JONAS,
            date,
            8.0,
            INTRANET,
            "Delivery (billable)",
            "Entwicklung",
            "Büro",
        ));
    }

    // Lena: Januar/Februar im Projekt, danach auf P200 abgezogen; am 02.03. noch
    // 2 h Übergabe aufs Projekt (→ außerhalb des Einsatzzeitraums, wird abgerechnet).
    if date.month() <= 2 {
        rows.push(work(
            LENA,
            date,
            8.0,
            PROJECT,
            "Delivery (billable)",
            "Entwicklung",
            "Home Office",
        ));
    } else if date == d(3, 2) {
        rows.push(work(
            LENA,
            date,
            2.0,
            PROJECT,
            "Delivery (billable)",
            "Übergabe",
            "Home Office",
        ));
        rows.push(work(
            LENA,
            date,
            6.0,
            INTRANET,
            "Delivery (billable)",
            "Entwicklung",
            "Büro",
        ));
    } else {
        rows.push(work(
            LENA,
            date,
            8.0,
            INTRANET,
            "Delivery (billable)",
            "Entwicklung",
            "Büro",
        ));
    }

    // Karl (Geschäftsführung, Rolle „darf buchen“): bucht gelegentlich aufs
    // Projekt – abgerechnet wird nur, was die Kost2Art als billable ausweist.
    let karl = match (date.month(), date.day()) {
        (2, 10) => Some((3.0, PROJECT, "Management", "Lenkungskreis")),
        (3, 17) => Some((4.0, INTERN, "Internal", "Strategie")),
        (6, 16) => Some((4.0, PROJECT, "Delivery (billable)", "Architektur-Review")),
        (9, 22) => Some((2.0, PROJECT, "Management", "Lenkungskreis")),
        _ => None,
    };
    if let Some((hours, element, kost2art, task)) = karl {
        rows.push(work(KARL, date, hours, element, kost2art, task, "Büro"));
    }
}

fn kost2_and_project(element: &str) -> (&'static str, &'static str) {
    match element {
        "P100 Lager-App" => ("5.100.01.01", "Lager-App"),
        "P200 Intranet" => ("5.200.01.01", "Intranet"),
        "Z900 Intern" => ("9.900.00.00", "Intern"),
        _ => ("", ""),
    }
}

/// Leere Texte als leere Zelle lassen (wie im echten Export).
fn text(ws: &mut Worksheet, row: u32, col: u16, value: &str) -> Result<(), XlsxError> {
    if !value.is_empty() {
        ws.write_string(row, col, value)?;
    }
    Ok(())
}

fn main() -> Result<(), XlsxError> {
    let out = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../sample-data/Beispiel-Export_2026-10-31.xlsx")
        });

    let mut rows = Vec::new();
    let mut date = NaiveDate::from_ymd_opt(START.0, START.1, START.2).unwrap();
    let cutoff = NaiveDate::from_ymd_opt(CUTOFF.0, CUTOFF.1, CUTOFF.2).unwrap();
    while date <= cutoff {
        rows_for_day(date, &mut rows);
        date = date.succ_opt().unwrap();
    }

    let mut workbook = Workbook::new();
    // Feste Metadaten → erneutes Erzeugen ändert die Datei nicht.
    workbook.set_properties(
        &DocProperties::new()
            .set_title("Beispiel-Export (fiktive Daten)")
            .set_author("Billing Tracker")
            .set_creation_datetime(&ExcelDateTime::from_ymd(2026, 10, 31)?),
    );

    let summary = workbook.add_worksheet();
    summary.set_name("Übersicht")?;
    summary.write_string(
        0,
        0,
        "Fiktiver Beispiel-Export – alle Namen und Werte sind ausgedacht.",
    )?;

    let ws = workbook.add_worksheet();
    ws.set_name("Details")?;
    let header_fmt = Format::new().set_bold();
    let date_fmt = Format::new().set_num_format("dd.mm.yyyy");
    let time_fmt = Format::new().set_num_format("[h]:mm");
    let hours_fmt = Format::new().set_num_format("0.00");

    let header = [
        "User",
        "Kost2",
        "Day",
        "Start",
        "Stop",
        "Duration",
        "Hours",
        "Task",
        "Mult",
        "Element",
        "Project",
        "Kost2Art",
        "Description",
        "Location",
    ];
    for (col, title) in header.iter().enumerate() {
        ws.write_string_with_format(0, col as u16, *title, &header_fmt)?;
    }
    for (col, width) in [
        (0, 18),
        (2, 11),
        (7, 22),
        (9, 16),
        (11, 20),
        (12, 24),
        (13, 14),
    ] {
        ws.set_column_width(col, width)?;
    }

    for (i, row) in rows.iter().enumerate() {
        let r = i as u32 + 1;
        let (kost2, project) = kost2_and_project(row.element);
        let excel_date = ExcelDateTime::from_ymd(
            row.date.year() as u16,
            row.date.month() as u8,
            row.date.day() as u8,
        )?;
        text(ws, r, 0, row.user)?;
        text(ws, r, 1, kost2)?;
        ws.write_datetime_with_format(r, 2, &excel_date, &date_fmt)?;
        ws.write_number_with_format(r, 5, row.hours / 24.0, &time_fmt)?;
        ws.write_number_with_format(r, 6, row.hours, &hours_fmt)?;
        text(ws, r, 7, row.task)?;
        if let Some(mult) = row.mult {
            ws.write_number(r, 8, mult)?;
        }
        text(ws, r, 9, row.element)?;
        text(ws, r, 10, project)?;
        text(ws, r, 11, row.kost2art)?;
        text(ws, r, 12, row.task)?;
        text(ws, r, 13, row.location)?;
    }

    workbook.save(&out)?;
    println!("{} Buchungen → {}", rows.len(), out.display());
    Ok(())
}
