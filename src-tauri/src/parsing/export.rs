//! Einlesen des ProjectForge-Exports mit calamine.

use std::path::Path;

use calamine::{Data, Range, Reader, open_workbook_auto};

use super::cells::{
    cell_billable_text, cell_date, cell_hours, cell_mult, cell_text, column_letter, describe,
    is_blank,
};
use crate::models::config::ExportFormat;
use crate::models::entry::TimeEntry;
use crate::models::results::SkippedRow;

#[derive(Debug)]
pub struct ParseOutcome {
    /// Tatsächlicher Name des Tabellenblatts (Groß-/Kleinschreibung wie in der Datei).
    pub sheet_name: String,
    pub entries: Vec<TimeEntry>,
    pub skipped: Vec<SkippedRow>,
}

/// Öffnet die Datei und liest das konfigurierte Tabellenblatt ein.
pub fn read_export(path: &Path, format: &ExportFormat) -> Result<ParseOutcome, String> {
    let mut workbook = open_workbook_auto(path).map_err(|e| {
        format!(
            "Datei „{}“ konnte nicht geöffnet werden: {e}",
            path.display()
        )
    })?;

    let sheet_names = workbook.sheet_names();
    let wanted = format.sheet_name.trim();
    let sheet_name = sheet_names
        .iter()
        .find(|name| name.as_str() == wanted)
        .or_else(|| {
            sheet_names
                .iter()
                .find(|name| name.trim().eq_ignore_ascii_case(wanted))
        })
        .cloned()
        .ok_or_else(|| {
            format!(
                "Tabellenblatt „{wanted}“ nicht gefunden. Vorhandene Blätter: {}",
                sheet_names.join(", ")
            )
        })?;

    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| format!("Tabellenblatt „{sheet_name}“ konnte nicht gelesen werden: {e}"))?;

    let (entries, skipped) = parse_range(&range, format, &sheet_name)?;
    Ok(ParseOutcome {
        sheet_name,
        entries,
        skipped,
    })
}

/// Wandelt die Zeilen eines Tabellenblatts in `TimeEntry`s um.
///
/// - Spaltenindizes aus dem Mapping sind absolut (0 = Spalte A), unabhängig
///   davon, wo der von calamine gelieferte Bereich beginnt.
/// - Zeilen vor der ersten gültigen Buchung (Kopf-/Titelzeilen) werden still
///   übersprungen, ebenso komplett leere Zeilen.
/// - Fehlerhafte Zeilen danach landen mit Begründung in `skipped`.
pub fn parse_range(
    range: &Range<Data>,
    format: &ExportFormat,
    sheet_name: &str,
) -> Result<(Vec<TimeEntry>, Vec<SkippedRow>), String> {
    let (Some((start_row, _)), Some((end_row, _))) = (range.start(), range.end()) else {
        return Err(format!("Tabellenblatt „{sheet_name}“ ist leer."));
    };
    let cols = &format.columns;

    let mut entries = Vec::new();
    let mut skipped = Vec::new();
    // Erste nicht leere Zeile, die nicht als Buchung erkannt wurde – für die Fehlermeldung.
    let mut first_rejected: Option<(usize, String)> = None;

    for row in start_row..=end_row {
        let cell = |col: usize| {
            u32::try_from(col)
                .ok()
                .and_then(|c| range.get_value((row, c)))
        };
        let excel_row = row as usize + 1;

        let name = cell_text(cell(cols.name));
        let date_cell = cell(cols.date);
        if name.is_empty() && is_blank(date_cell) {
            continue;
        }

        let date = match cell_date(date_cell) {
            Ok(date) => date,
            Err(reason) => {
                if entries.is_empty() {
                    first_rejected.get_or_insert((excel_row, describe(date_cell)));
                } else {
                    skipped.push(SkippedRow {
                        row: excel_row,
                        reason: format!("Spalte {} (Datum): {reason}", column_letter(cols.date)),
                    });
                }
                continue;
            }
        };

        if name.is_empty() {
            skipped.push(SkippedRow {
                row: excel_row,
                reason: format!("Spalte {} (Name) ist leer", column_letter(cols.name)),
            });
            continue;
        }

        let hours = match cell_hours(cell(cols.duration)) {
            Ok(hours) => hours,
            Err(reason) => {
                skipped.push(SkippedRow {
                    row: excel_row,
                    reason: format!("Spalte {} (Dauer): {reason}", column_letter(cols.duration)),
                });
                continue;
            }
        };

        let mult = match cell_mult(cell(cols.mult)) {
            Ok(mult) => mult,
            Err(reason) => {
                skipped.push(SkippedRow {
                    row: excel_row,
                    reason: format!("Spalte {} (Mult): {reason}", column_letter(cols.mult)),
                });
                continue;
            }
        };

        entries.push(TimeEntry {
            name,
            date,
            hours,
            mult,
            element: cell_text(cell(cols.element)),
            kost2art: cell_text(cell(cols.kost2art)),
            location: cell_text(cell(cols.location)),
            billable: format
                .billable
                .as_ref()
                .map(|b| cell_billable_text(cell(b.column))),
        });
    }

    if entries.is_empty() {
        let hint = match first_rejected {
            Some((row, content)) => format!(
                " In Zeile {row}, Spalte {} (Datum) steht {content}.",
                column_letter(cols.date)
            ),
            None => String::new(),
        };
        return Err(format!(
            "Keine gültigen Buchungen in „{sheet_name}“ gefunden – bitte das Spalten-Mapping prüfen.{hint}"
        ));
    }

    Ok((entries, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::config::ColumnMapping;
    use chrono::NaiveDate;
    use rust_xlsxwriter::{Format, Workbook};

    fn serial(y: i32, m: u32, d: u32) -> f64 {
        let epoch = NaiveDate::from_ymd_opt(1899, 12, 30).unwrap();
        (NaiveDate::from_ymd_opt(y, m, d).unwrap() - epoch).num_days() as f64
    }

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    /// Baut eine Export-Datei im Standard-Layout (siehe `ColumnMapping::default`).
    fn write_sample_export(path: &Path) {
        let date_fmt = Format::new().set_num_format("dd.mm.yyyy");
        let time_fmt = Format::new().set_num_format("[h]:mm");

        let mut workbook = Workbook::new();
        workbook.add_worksheet().set_name("Übersicht").unwrap();
        let ws = workbook.add_worksheet();
        ws.set_name("Details").unwrap();

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
            ws.write_string(0, col as u16, *title).unwrap();
        }

        // Zeile 2: Excel-Datum, Dauer als Zeitwert (7:30), Mult leer.
        ws.write_string(1, 0, "Erika Mustermann").unwrap();
        ws.write_number_with_format(1, 2, serial(2026, 10, 5), &date_fmt)
            .unwrap();
        ws.write_number_with_format(1, 5, 7.5 / 24.0, &time_fmt)
            .unwrap();
        ws.write_string(1, 9, "P100 Lager-App").unwrap();
        ws.write_string(1, 11, "Delivery (billable)").unwrap();
        ws.write_string(1, 13, "Remote").unwrap();

        // Zeile 3: Datum als Text, Dauer als Zahl, Mult als Text mit Komma.
        ws.write_string(2, 0, "Max Mustermann").unwrap();
        ws.write_string(2, 2, "06.10.2026").unwrap();
        ws.write_number(2, 5, 2.5).unwrap();
        ws.write_string(2, 8, "1,5").unwrap();
        ws.write_string(2, 9, "P100 Lager-App").unwrap();
        ws.write_string(2, 11, "Travel (billable)").unwrap();
        ws.write_string(2, 13, "Kunde").unwrap();

        // Zeile 4: leer – wird ignoriert.

        // Zeile 5: Wochenende (Samstag), Mult 0.
        ws.write_string(4, 0, "Erika Mustermann").unwrap();
        ws.write_number_with_format(4, 2, serial(2026, 10, 10), &date_fmt)
            .unwrap();
        ws.write_string(4, 5, "1:15").unwrap();
        ws.write_number(4, 8, 0.0).unwrap();
        ws.write_string(4, 9, "Intern").unwrap();
        ws.write_string(4, 11, "Sales").unwrap();

        // Zeile 6: Krankheitstag (Personio liefert 8 h).
        ws.write_string(5, 0, "Max Mustermann").unwrap();
        ws.write_number_with_format(5, 2, serial(2026, 10, 7), &date_fmt)
            .unwrap();
        ws.write_number(5, 5, 8).unwrap();
        ws.write_string(5, 9, "(Sick)").unwrap();

        // Zeile 7: kaputtes Datum → übersprungen.
        ws.write_string(6, 0, "Erika Mustermann").unwrap();
        ws.write_string(6, 2, "irgendwann").unwrap();
        ws.write_number(6, 5, 1.0).unwrap();

        // Zeile 8: Dauer fehlt → übersprungen.
        ws.write_string(7, 0, "Erika Mustermann").unwrap();
        ws.write_number_with_format(7, 2, serial(2026, 10, 8), &date_fmt)
            .unwrap();
        ws.write_string(7, 9, "P100 Lager-App").unwrap();

        workbook.save(path).unwrap();
    }

    #[test]
    fn reads_sample_export() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.xlsx");
        write_sample_export(&path);

        let outcome = read_export(&path, &ExportFormat::default()).unwrap();
        assert_eq!(outcome.sheet_name, "Details");
        assert_eq!(outcome.entries.len(), 4, "{:#?}", outcome.entries);

        let first = &outcome.entries[0];
        assert_eq!(first.name, "Erika Mustermann");
        assert_eq!(first.date, date(2026, 10, 5));
        assert!((first.hours - 7.5).abs() < 1e-9);
        assert_eq!(first.mult, 1.0);
        assert_eq!(first.element, "P100 Lager-App");
        assert_eq!(first.kost2art, "Delivery (billable)");
        assert_eq!(first.location, "Remote");

        let second = &outcome.entries[1];
        assert_eq!(second.date, date(2026, 10, 6));
        assert_eq!(second.hours, 2.5);
        assert_eq!(second.mult, 1.5);

        let weekend = &outcome.entries[2];
        assert_eq!(weekend.date, date(2026, 10, 10));
        assert_eq!(weekend.hours, 1.25);
        assert_eq!(weekend.mult, 0.0);

        let sick = &outcome.entries[3];
        assert_eq!(sick.element, "(Sick)");
        assert_eq!(sick.hours, 8.0);

        let rows: Vec<usize> = outcome.skipped.iter().map(|s| s.row).collect();
        assert_eq!(rows, vec![7, 8], "{:#?}", outcome.skipped);
        assert!(outcome.skipped[0].reason.contains("Spalte C (Datum)"));
        assert!(outcome.skipped[1].reason.contains("Spalte F (Dauer)"));
    }

    #[test]
    fn sheet_name_is_matched_case_insensitively() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.xlsx");
        write_sample_export(&path);

        let format = ExportFormat {
            sheet_name: "details".into(),
            ..ExportFormat::default()
        };
        assert_eq!(read_export(&path, &format).unwrap().sheet_name, "Details");
    }

    #[test]
    fn unknown_sheet_lists_available_sheets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.xlsx");
        write_sample_export(&path);

        let format = ExportFormat {
            sheet_name: "Buchungen".into(),
            ..ExportFormat::default()
        };
        let err = read_export(&path, &format).unwrap_err();
        assert!(err.contains("„Buchungen“ nicht gefunden"), "{err}");
        assert!(err.contains("Übersicht, Details"), "{err}");
    }

    #[test]
    fn wrong_mapping_gives_helpful_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.xlsx");
        write_sample_export(&path);

        let format = ExportFormat {
            columns: ColumnMapping {
                date: 9, // Element-Spalte statt Datum
                ..ColumnMapping::default()
            },
            ..ExportFormat::default()
        };
        let err = read_export(&path, &format).unwrap_err();
        assert!(err.contains("Spalten-Mapping"), "{err}");
        assert!(
            err.contains("Zeile 1, Spalte J (Datum) steht „Element“"),
            "{err}"
        );
    }

    #[test]
    fn column_indices_are_absolute_even_if_column_a_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("offset.xlsx");
        let mut workbook = Workbook::new();
        let ws = workbook.add_worksheet();
        ws.set_name("Details").unwrap();
        // Spalte A bleibt komplett leer → calamine-Bereich beginnt bei B.
        ws.write_string(0, 1, "Erika Mustermann").unwrap();
        ws.write_string(0, 2, "2026-10-05").unwrap();
        ws.write_number(0, 3, 4.0).unwrap();
        workbook.save(&path).unwrap();

        let format = ExportFormat {
            columns: ColumnMapping {
                name: 1,
                date: 2,
                duration: 3,
                mult: 4,
                element: 5,
                kost2art: 6,
                location: 7,
            },
            ..ExportFormat::default()
        };
        let outcome = read_export(&path, &format).unwrap();
        assert_eq!(outcome.entries.len(), 1);
        assert_eq!(outcome.entries[0].name, "Erika Mustermann");
        assert_eq!(outcome.entries[0].hours, 4.0);
        assert_eq!(outcome.entries[0].mult, 1.0);
    }

    #[test]
    fn rows_without_name_or_with_bad_mult_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.xlsx");
        let mut workbook = Workbook::new();
        let ws = workbook.add_worksheet();
        ws.set_name("Details").unwrap();
        ws.write_string(0, 0, "Erika Mustermann").unwrap();
        ws.write_string(0, 2, "2026-10-05").unwrap();
        ws.write_number(0, 5, 8.0).unwrap();
        // Zeile 2: Datum, aber kein Name
        ws.write_string(1, 2, "2026-10-06").unwrap();
        ws.write_number(1, 5, 8.0).unwrap();
        // Zeile 3: ungültiger Mult
        ws.write_string(2, 0, "Erika Mustermann").unwrap();
        ws.write_string(2, 2, "2026-10-07").unwrap();
        ws.write_number(2, 5, 8.0).unwrap();
        ws.write_string(2, 8, "doppelt").unwrap();
        workbook.save(&path).unwrap();

        let outcome = read_export(&path, &ExportFormat::default()).unwrap();
        assert_eq!(outcome.entries.len(), 1);
        let reasons: Vec<(usize, &str)> = outcome
            .skipped
            .iter()
            .map(|s| (s.row, s.reason.as_str()))
            .collect();
        assert_eq!(reasons[0], (2, "Spalte A (Name) ist leer"));
        assert_eq!(reasons[1].0, 3);
        assert!(reasons[1].1.starts_with("Spalte I (Mult)"), "{reasons:?}");
    }

    #[test]
    fn empty_sheet_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("leer.xlsx");
        let mut workbook = Workbook::new();
        workbook.add_worksheet().set_name("Details").unwrap();
        workbook.save(&path).unwrap();
        let err = read_export(&path, &ExportFormat::default()).unwrap_err();
        assert!(err.contains("ist leer"), "{err}");
    }

    #[test]
    fn missing_file_is_reported() {
        let err =
            read_export(Path::new("/nicht/vorhanden.xlsx"), &ExportFormat::default()).unwrap_err();
        assert!(err.contains("konnte nicht geöffnet werden"), "{err}");
    }
}
