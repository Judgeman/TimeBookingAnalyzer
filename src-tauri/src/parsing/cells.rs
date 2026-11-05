//! Umwandlung einzelner calamine-Zellen in Text, Datum, Stunden und Multiplikator.
//!
//! Der Export ist nicht immer einheitlich typisiert: Datumswerte können als
//! Excel-Datum, als Seriennummer oder als Text vorliegen; die Dauer als Zahl
//! (Stunden), als Excel-Zeitwert (Bruchteil eines Tages) oder als Text ("1:30").

use calamine::{Data, ExcelDateTime, ExcelDateTimeType};
use chrono::{Datelike, NaiveDate};

use crate::models::config::BillableColumn;

/// Größte gültige Excel-Seriennummer (9999-12-31).
const MAX_EXCEL_SERIAL: f64 = 2_958_466.0;

pub fn is_blank(cell: Option<&Data>) -> bool {
    match cell {
        None | Some(Data::Empty) => true,
        Some(Data::String(s)) => s.trim().is_empty(),
        _ => false,
    }
}

/// Zellinhalt als getrimmter Text. Leere Zellen und Fehlerwerte ergeben "".
pub fn cell_text(cell: Option<&Data>) -> String {
    match cell {
        None | Some(Data::Empty) | Some(Data::Error(_)) => String::new(),
        Some(Data::String(s)) | Some(Data::DateTimeIso(s)) | Some(Data::DurationIso(s)) => {
            s.trim().to_string()
        }
        Some(Data::Int(i)) => i.to_string(),
        Some(Data::Float(f)) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", *f as i64),
        Some(Data::Float(f)) => f.to_string(),
        Some(Data::Bool(b)) => b.to_string(),
        Some(Data::DateTime(dt)) => match dt.as_datetime() {
            Some(d) if dt.is_datetime() => d.date().to_string(),
            _ => dt.as_f64().to_string(),
        },
    }
}

/// Wert der Billable-Spalte: echte Wahrheitswerte oder die eingestellten Texte
/// (ohne Groß-/Kleinschreibung); leer oder unbekannt = `None`.
pub fn cell_billable(cell: Option<&Data>, column: &BillableColumn) -> Option<bool> {
    if let Some(Data::Bool(value)) = cell {
        return Some(*value);
    }
    let text = cell_text(cell).to_lowercase();
    if text.is_empty() {
        None
    } else if text == column.yes.trim().to_lowercase() {
        Some(true)
    } else if text == column.no.trim().to_lowercase() {
        Some(false)
    } else {
        None
    }
}

/// Kurze Darstellung eines Zellinhalts für Fehlermeldungen.
pub fn describe(cell: Option<&Data>) -> String {
    if is_blank(cell) {
        return "leer".to_string();
    }
    let text = cell_text(cell);
    let short: String = text.chars().take(40).collect();
    if short.len() < text.len() {
        format!("„{short}…“")
    } else {
        format!("„{short}“")
    }
}

pub fn cell_date(cell: Option<&Data>) -> Result<NaiveDate, String> {
    match cell {
        None | Some(Data::Empty) => Err("Datum fehlt".to_string()),
        Some(Data::DateTime(dt)) => dt
            .as_datetime()
            .map(|d| d.date())
            .ok_or_else(|| "Datum außerhalb des gültigen Bereichs".to_string()),
        Some(Data::Float(f)) => date_from_serial(*f),
        Some(Data::Int(i)) => date_from_serial(*i as f64),
        Some(Data::String(s)) | Some(Data::DateTimeIso(s)) => {
            parse_date_text(s).ok_or_else(|| format!("kein gültiges Datum: {}", describe(cell)))
        }
        Some(_) => Err(format!("kein gültiges Datum: {}", describe(cell))),
    }
}

fn date_from_serial(serial: f64) -> Result<NaiveDate, String> {
    if !(1.0..MAX_EXCEL_SERIAL).contains(&serial) {
        return Err(format!("Zahl {serial} ist kein Excel-Datum"));
    }
    ExcelDateTime::new(serial, ExcelDateTimeType::DateTime, false)
        .as_datetime()
        .map(|d| d.date())
        .ok_or_else(|| format!("Zahl {serial} ist kein Excel-Datum"))
}

/// Akzeptiert u. a. "2026-10-05", "05.10.2026", "05.10.26", "2026-10-05T08:00:00"
/// und "Mo, 05.10.2026".
pub fn parse_date_text(text: &str) -> Option<NaiveDate> {
    const FORMATS: [&str; 4] = ["%Y-%m-%d", "%d.%m.%Y", "%d.%m.%y", "%Y/%m/%d"];
    text.split(|c: char| c.is_whitespace() || c == 'T' || c == ',')
        .filter(|token| !token.is_empty())
        .find_map(|token| {
            FORMATS
                .iter()
                .find_map(|fmt| NaiveDate::parse_from_str(token, fmt).ok())
                // chrono akzeptiert auch abgeschnittene Jahre wie "202".
                .filter(|d| (1900..=2100).contains(&d.year()))
        })
}

/// Gebuchte Dauer in Stunden.
pub fn cell_hours(cell: Option<&Data>) -> Result<f64, String> {
    match cell {
        None | Some(Data::Empty) => Err("Dauer fehlt".to_string()),
        // Excel-Zeitwert: 1.0 = 24 Stunden.
        Some(Data::DateTime(dt)) => Ok(dt.as_f64() * 24.0),
        Some(Data::Float(f)) => Ok(*f),
        Some(Data::Int(i)) => Ok(*i as f64),
        Some(Data::String(s)) => {
            parse_hours_text(s).ok_or_else(|| format!("keine gültige Dauer: {}", describe(cell)))
        }
        Some(Data::DurationIso(s)) => {
            parse_iso_duration(s).ok_or_else(|| format!("keine gültige Dauer: {}", describe(cell)))
        }
        Some(_) => Err(format!("keine gültige Dauer: {}", describe(cell))),
    }
}

/// "8", "8,5", "8.5 h", "1:30", "1:30:00".
fn parse_hours_text(text: &str) -> Option<f64> {
    let text = text.trim().trim_end_matches(['h', 'H']).trim();
    if text.is_empty() {
        return None;
    }
    if text.contains(':') {
        let mut parts = text.split(':');
        let hours: f64 = parts.next()?.trim().parse().ok()?;
        let minutes: f64 = parts.next().map_or(Some(0.0), |m| m.trim().parse().ok())?;
        let seconds: f64 = parts.next().map_or(Some(0.0), |s| s.trim().parse().ok())?;
        if parts.next().is_some() {
            return None;
        }
        let sign = if text.starts_with('-') { -1.0 } else { 1.0 };
        return Some(hours + sign * (minutes / 60.0 + seconds / 3600.0));
    }
    parse_decimal(text)
}

/// Minimaler Parser für ISO-8601-Dauern wie "PT8H30M" oder "P1DT2H".
fn parse_iso_duration(text: &str) -> Option<f64> {
    let rest = text.trim().strip_prefix('P')?;
    let mut hours = 0.0;
    let mut number = String::new();
    let mut in_time = false;
    for c in rest.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' | '.' | ',' => number.push(if c == ',' { '.' } else { c }),
            'D' | 'H' | 'M' | 'S' => {
                let value: f64 = number.parse().ok()?;
                number.clear();
                hours += match (c, in_time) {
                    ('D', false) => value * 24.0,
                    ('H', true) => value,
                    ('M', true) => value / 60.0,
                    ('S', true) => value / 3600.0,
                    _ => return None,
                };
            }
            _ => return None,
        }
    }
    number.is_empty().then_some(hours)
}

/// Multiplikator. Leere Zelle = 1.0.
pub fn cell_mult(cell: Option<&Data>) -> Result<f64, String> {
    if is_blank(cell) {
        return Ok(1.0);
    }
    match cell {
        Some(Data::Float(f)) => Ok(*f),
        Some(Data::Int(i)) => Ok(*i as f64),
        Some(Data::DateTime(dt)) => Ok(dt.as_f64()),
        Some(Data::String(s)) => {
            let s = s.trim();
            let parsed = match s.strip_suffix('%') {
                Some(percent) => parse_decimal(percent.trim()).map(|p| p / 100.0),
                None => parse_decimal(s),
            };
            parsed.ok_or_else(|| format!("kein gültiger Multiplikator: {}", describe(cell)))
        }
        _ => Err(format!("kein gültiger Multiplikator: {}", describe(cell))),
    }
}

/// Dezimalzahl mit Punkt oder deutschem Komma.
fn parse_decimal(text: &str) -> Option<f64> {
    text.replace(',', ".")
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
}

/// Spaltenbuchstabe für einen 0-basierten Index (0 → "A", 26 → "AA").
pub fn column_letter(index: usize) -> String {
    let mut n = index + 1;
    let mut letters = Vec::new();
    while n > 0 {
        let rem = (n - 1) % 26;
        letters.push(b'A' + rem as u8);
        n = (n - 1) / 26;
    }
    letters.reverse();
    String::from_utf8(letters).expect("ASCII")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(text: &str) -> Data {
        Data::String(text.to_string())
    }

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn billable_values_as_booleans_or_configured_text() {
        let column = BillableColumn {
            column: 14,
            yes: "WAHR".into(),
            no: "FALSCH".into(),
        };
        assert_eq!(cell_billable(Some(&Data::Bool(true)), &column), Some(true));
        assert_eq!(
            cell_billable(Some(&Data::Bool(false)), &column),
            Some(false)
        );
        assert_eq!(cell_billable(Some(&s("WAHR")), &column), Some(true));
        assert_eq!(cell_billable(Some(&s(" falsch ")), &column), Some(false));
        assert_eq!(cell_billable(Some(&s("vielleicht")), &column), None);
        assert_eq!(cell_billable(Some(&Data::Empty), &column), None);
        assert_eq!(cell_billable(None, &column), None);
        // eigene Werte, auch mit Umlauten und Zahlen
        let custom = BillableColumn {
            column: 3,
            yes: "Ja".into(),
            no: "NÖ".into(),
        };
        assert_eq!(cell_billable(Some(&s("ja")), &custom), Some(true));
        assert_eq!(cell_billable(Some(&s("nö")), &custom), Some(false));
        assert_eq!(cell_billable(Some(&s("WAHR")), &custom), None);
        let numbers = BillableColumn {
            column: 3,
            yes: "1".into(),
            no: "0".into(),
        };
        assert_eq!(cell_billable(Some(&Data::Float(1.0)), &numbers), Some(true));
        assert_eq!(cell_billable(Some(&Data::Int(0)), &numbers), Some(false));
    }

    #[test]
    fn dates_in_all_supported_shapes() {
        let excel = Data::DateTime(ExcelDateTime::new(
            46300.0,
            ExcelDateTimeType::DateTime,
            false,
        ));
        assert_eq!(cell_date(Some(&excel)), Ok(date(2026, 10, 5)));
        assert_eq!(
            cell_date(Some(&Data::Float(46300.0))),
            Ok(date(2026, 10, 5))
        );
        assert_eq!(cell_date(Some(&s("2026-10-05"))), Ok(date(2026, 10, 5)));
        assert_eq!(cell_date(Some(&s("05.10.2026"))), Ok(date(2026, 10, 5)));
        assert_eq!(cell_date(Some(&s("Mo, 05.10.2026"))), Ok(date(2026, 10, 5)));
        assert_eq!(
            cell_date(Some(&Data::DateTimeIso("2026-10-05T08:15:00".into()))),
            Ok(date(2026, 10, 5))
        );
        assert!(cell_date(Some(&s("Datum"))).is_err());
        assert!(cell_date(Some(&s("05.10.202"))).is_err());
        assert!(cell_date(None).is_err());
        assert!(cell_date(Some(&Data::Float(-3.0))).is_err());
    }

    #[test]
    fn hours_from_numbers_time_values_and_text() {
        let time_value = Data::DateTime(ExcelDateTime::new(
            0.3125,
            ExcelDateTimeType::TimeDelta,
            false,
        ));
        assert!((cell_hours(Some(&time_value)).unwrap() - 7.5).abs() < 1e-9);
        assert_eq!(cell_hours(Some(&Data::Float(2.25))), Ok(2.25));
        assert_eq!(cell_hours(Some(&Data::Int(8))), Ok(8.0));
        assert_eq!(cell_hours(Some(&s("8,5"))), Ok(8.5));
        assert_eq!(cell_hours(Some(&s("8.5 h"))), Ok(8.5));
        assert_eq!(cell_hours(Some(&s("1:30"))), Ok(1.5));
        assert_eq!(cell_hours(Some(&s("-0:30"))), Ok(-0.5));
        assert_eq!(
            cell_hours(Some(&Data::DurationIso("PT8H30M".into()))),
            Ok(8.5)
        );
        assert!(cell_hours(Some(&Data::Empty)).is_err());
        assert!(cell_hours(Some(&s("viel"))).is_err());
    }

    #[test]
    fn mult_defaults_to_one() {
        assert_eq!(cell_mult(None), Ok(1.0));
        assert_eq!(cell_mult(Some(&Data::Empty)), Ok(1.0));
        assert_eq!(cell_mult(Some(&s("  "))), Ok(1.0));
        assert_eq!(cell_mult(Some(&Data::Float(0.0))), Ok(0.0));
        assert_eq!(cell_mult(Some(&s("1,5"))), Ok(1.5));
        assert_eq!(cell_mult(Some(&s("50%"))), Ok(0.5));
        assert!(cell_mult(Some(&s("x"))).is_err());
    }

    #[test]
    fn text_of_numeric_cells() {
        assert_eq!(cell_text(Some(&Data::Float(8.0))), "8");
        assert_eq!(cell_text(Some(&Data::Float(8.5))), "8.5");
        assert_eq!(cell_text(Some(&s("  P100 Lager-App "))), "P100 Lager-App");
        assert_eq!(cell_text(None), "");
    }

    #[test]
    fn text_and_description_of_other_cell_types() {
        use calamine::CellErrorType;
        assert_eq!(cell_text(Some(&Data::Int(42))), "42");
        assert_eq!(cell_text(Some(&Data::Bool(true))), "true");
        assert_eq!(cell_text(Some(&Data::Error(CellErrorType::NA))), "");
        let date = Data::DateTime(ExcelDateTime::new(
            46300.0,
            ExcelDateTimeType::DateTime,
            false,
        ));
        assert_eq!(cell_text(Some(&date)), "2026-10-05");
        let time = Data::DateTime(ExcelDateTime::new(0.5, ExcelDateTimeType::TimeDelta, false));
        assert_eq!(cell_text(Some(&time)), "0.5");

        assert_eq!(describe(None), "leer");
        assert_eq!(describe(Some(&s("Datum"))), "„Datum“");
        let long = "x".repeat(50);
        assert_eq!(describe(Some(&s(&long))), format!("„{}…“", "x".repeat(40)));
    }

    #[test]
    fn rejects_unusable_dates_hours_and_mult() {
        assert!(cell_date(Some(&Data::Int(5_000_000))).is_err());
        assert!(
            cell_date(Some(&Data::Bool(true)))
                .unwrap_err()
                .contains("kein gültiges Datum")
        );
        assert_eq!(cell_date(Some(&Data::Int(46300))), Ok(date(2026, 10, 5)));
        assert!(cell_hours(Some(&Data::Bool(true))).is_err());
        assert!(cell_hours(Some(&s("  h "))).is_err());
        assert!(cell_hours(Some(&s("1:2:3:4"))).is_err());
        assert_eq!(
            cell_hours(Some(&Data::DurationIso("P1DT2H".into()))),
            Ok(26.0)
        );
        assert!(cell_hours(Some(&Data::DurationIso("PT8X".into()))).is_err());
        assert!(cell_hours(Some(&Data::DurationIso("P2H".into()))).is_err());
        assert_eq!(cell_mult(Some(&Data::Int(2))), Ok(2.0));
        let excel = Data::DateTime(ExcelDateTime::new(0.5, ExcelDateTimeType::DateTime, false));
        assert_eq!(cell_mult(Some(&excel)), Ok(0.5));
        assert!(cell_mult(Some(&Data::Bool(false))).is_err());
        assert!(cell_mult(Some(&s("viel%"))).is_err());
    }

    #[test]
    fn column_letters() {
        assert_eq!(column_letter(0), "A");
        assert_eq!(column_letter(13), "N");
        assert_eq!(column_letter(25), "Z");
        assert_eq!(column_letter(26), "AA");
        assert_eq!(column_letter(701), "ZZ");
        assert_eq!(column_letter(702), "AAA");
    }
}
