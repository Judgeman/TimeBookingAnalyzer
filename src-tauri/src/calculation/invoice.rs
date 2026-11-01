//! Rechnungsdaten: pro Monat eine Rechnung mit Positionen je Person × Stundensatz.
//!
//! Beträge werden in Cent gerechnet: Netto je Position = gerundete Stunden ×
//! Satz (kaufmännisch auf Cent gerundet), USt. je Monatsrechnung auf den
//! Netto-Gesamtbetrag, Brutto = Netto + USt. Die Jahressummen addieren die
//! Monatsrechnungen.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate};

use super::round2;
use crate::models::results::{InvoiceLine, InvoiceMonth, InvoiceSummary, InvoiceTotals};

#[derive(Default)]
struct LineAcc {
    person: String,
    rate: Option<f64>,
    delivery_h: f64,
    other_h: f64,
}

pub struct InvoiceBuilder {
    vat_percent: f64,
    cutoff: NaiveDate,
    /// (Monat, Team-Index, Satz in 1/10000 €) → Position
    lines: BTreeMap<(String, usize, Option<i64>), LineAcc>,
}

impl InvoiceBuilder {
    pub fn new(vat_percent: f64, cutoff: NaiveDate) -> Self {
        Self {
            vat_percent,
            cutoff,
            lines: BTreeMap::new(),
        }
    }

    pub fn add(
        &mut self,
        month: &str,
        person_index: usize,
        person: &str,
        rate: Option<f64>,
        hours: f64,
        is_delivery: bool,
    ) {
        let rate_key = rate.map(|r| (r * 10_000.0).round() as i64);
        let line = self
            .lines
            .entry((month.to_string(), person_index, rate_key))
            .or_insert_with(|| LineAcc {
                person: person.to_string(),
                rate,
                ..LineAcc::default()
            });
        if is_delivery {
            line.delivery_h += hours;
        } else {
            line.other_h += hours;
        }
    }

    pub fn finish(self) -> InvoiceSummary {
        let mut months: Vec<InvoiceMonth> = Vec::new();
        let mut total = Totals::default();

        for ((month, _, _), acc) in self.lines {
            let hours = round2(acc.delivery_h + acc.other_h);
            let net_cents = acc.rate.map_or(0, |rate| to_cents(hours * rate));
            let line = InvoiceLine {
                person: acc.person,
                rate: acc.rate,
                delivery_h: round2(acc.delivery_h),
                other_h: round2(acc.other_h),
                hours,
                net: from_cents(net_cents),
            };

            if months.last().is_none_or(|m| m.month != month) {
                months.push(InvoiceMonth {
                    partial: is_partial(&month, self.cutoff),
                    month,
                    lines: Vec::new(),
                    hours: 0.0,
                    net: 0.0,
                    vat: 0.0,
                    gross: 0.0,
                });
            }
            months.last_mut().expect("gerade angelegt").lines.push(line);
        }

        for month in &mut months {
            let net_cents: i64 = month.lines.iter().map(|l| to_cents(l.net)).sum();
            let vat_cents = (net_cents as f64 * self.vat_percent / 100.0).round() as i64;
            month.hours = round2(month.lines.iter().map(|l| l.hours).sum());
            month.net = from_cents(net_cents);
            month.vat = from_cents(vat_cents);
            month.gross = from_cents(net_cents + vat_cents);

            total.hours += month.hours;
            total.net_cents += net_cents;
            total.vat_cents += vat_cents;
        }

        InvoiceSummary {
            vat_percent: self.vat_percent,
            months,
            total: InvoiceTotals {
                hours: round2(total.hours),
                net: from_cents(total.net_cents),
                vat: from_cents(total.vat_cents),
                gross: from_cents(total.net_cents + total.vat_cents),
            },
        }
    }
}

#[derive(Default)]
struct Totals {
    hours: f64,
    net_cents: i64,
    vat_cents: i64,
}

fn to_cents(euro: f64) -> i64 {
    (euro * 100.0).round() as i64
}

fn from_cents(cents: i64) -> f64 {
    cents as f64 / 100.0
}

/// Monat des Stichtags, der zum Stichtag noch nicht zu Ende ist.
fn is_partial(month: &str, cutoff: NaiveDate) -> bool {
    let cutoff_month = format!("{:04}-{:02}", cutoff.year(), cutoff.month());
    let last_day = cutoff
        .with_day(1)
        .and_then(|first| first.checked_add_months(chrono::Months::new(1)))
        .and_then(|next| next.pred_opt())
        .expect("gültiges Datum");
    month == cutoff_month && cutoff < last_day
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    #[test]
    fn groups_by_month_person_and_rate_and_computes_vat() {
        let mut builder = InvoiceBuilder::new(19.0, d(10, 15));
        // September: Erika mit Satzwechsel, Max mit Reisezeit
        builder.add("2026-09", 0, "Erika", Some(100.0), 10.0, true);
        builder.add("2026-09", 0, "Erika", Some(105.0), 5.5, true);
        builder.add("2026-09", 1, "Max", Some(90.0), 8.0, true);
        builder.add("2026-09", 1, "Max", Some(90.0), 2.0, false);
        // Oktober (Teilmonat), eine Position ohne Satz
        builder.add("2026-10", 1, "Max", Some(95.0), 1.0 / 3.0, true);
        builder.add("2026-10", 0, "Erika", None, 4.0, true);

        let invoice = builder.finish();
        assert_eq!(invoice.months.len(), 2);

        let sep = &invoice.months[0];
        assert!(!sep.partial);
        let summary: Vec<(&str, Option<f64>, f64, f64)> = sep
            .lines
            .iter()
            .map(|l| (l.person.as_str(), l.rate, l.hours, l.net))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("Erika", Some(100.0), 10.0, 1000.0),
                ("Erika", Some(105.0), 5.5, 577.5),
                ("Max", Some(90.0), 10.0, 900.0),
            ]
        );
        assert_eq!(sep.lines[2].delivery_h, 8.0);
        assert_eq!(sep.lines[2].other_h, 2.0);
        assert_eq!(sep.net, 2477.5);
        assert_eq!(sep.vat, 470.73); // 2477,50 × 19 % = 470,725 → 470,73
        assert_eq!(sep.gross, 2948.23);

        let oct = &invoice.months[1];
        assert!(oct.partial);
        assert_eq!(oct.lines[0].person, "Erika"); // Team-Reihenfolge
        assert_eq!(oct.lines[0].rate, None);
        assert_eq!(oct.lines[0].net, 0.0);
        assert_eq!(oct.lines[1].hours, 0.33);
        assert_eq!(oct.lines[1].net, 31.35); // 0,33 h × 95 €
        assert_eq!(oct.net, 31.35);
        assert_eq!(oct.vat, 5.96);

        assert_eq!(invoice.total.net, 2508.85);
        assert_eq!(invoice.total.vat, 476.69);
        assert_eq!(invoice.total.gross, 2985.54);
        assert_eq!(invoice.total.hours, 29.83);
    }

    #[test]
    fn last_day_of_month_is_not_partial() {
        assert!(!is_partial("2026-10", d(10, 31)));
        assert!(is_partial("2026-10", d(10, 30)));
        assert!(!is_partial("2026-09", d(10, 15)));
        assert!(!is_partial("2026-02", d(2, 28)));
    }
}
