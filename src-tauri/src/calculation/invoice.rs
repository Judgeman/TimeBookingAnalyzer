//! Rechnungsdaten: pro Monat eine Rechnung mit Positionen je
//! Person × Leistung (Abrechnungsregel) × Stundensatz × USt.-Satz.
//!
//! Beträge werden in Cent gerechnet: Netto je Position = auf 2 Stellen
//! gerundete Stunden × abgerechneter Satz (kaufmännisch auf Cent gerundet).
//! Die USt. wird je Monatsrechnung und Steuersatz auf die Netto-Summe
//! berechnet, Brutto = Netto + USt. Jahressummen addieren die Monatsrechnungen.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate};

use super::round2;
use crate::models::results::{InvoiceLine, InvoiceMonth, InvoiceSummary, InvoiceTotals, VatGroup};

/// Eine billable Buchung, wie sie in die Rechnung eingeht.
pub struct InvoiceItem<'a> {
    pub month: String,
    pub person_index: usize,
    pub person: &'a str,
    pub rule_index: usize,
    pub service: &'a str,
    /// Stundensatz der Person am Buchungstag.
    pub base_rate: Option<f64>,
    pub rate_percent: f64,
    pub vat_percent: f64,
    pub hours: f64,
    /// Buchung liegt außerhalb des Einsatzzeitraums der Person.
    pub outside: bool,
}

struct LineAcc {
    person: String,
    service: String,
    base_rate: Option<f64>,
    rate_percent: f64,
    vat_percent: f64,
    hours: f64,
    outside_hours: f64,
}

type LineKey = (String, usize, usize, Option<i64>, i64, i64);

pub struct InvoiceBuilder {
    vat_percent: f64,
    cutoff: NaiveDate,
    lines: BTreeMap<LineKey, LineAcc>,
}

impl InvoiceBuilder {
    pub fn new(vat_percent: f64, cutoff: NaiveDate) -> Self {
        Self {
            vat_percent,
            cutoff,
            lines: BTreeMap::new(),
        }
    }

    pub fn add(&mut self, item: InvoiceItem<'_>) {
        let key = (
            item.month,
            item.person_index,
            item.rule_index,
            item.base_rate.map(fixed),
            fixed(item.rate_percent),
            fixed(item.vat_percent),
        );
        let line = self.lines.entry(key).or_insert_with(|| LineAcc {
            person: item.person.to_string(),
            service: item.service.to_string(),
            base_rate: item.base_rate,
            rate_percent: item.rate_percent,
            vat_percent: item.vat_percent,
            hours: 0.0,
            outside_hours: 0.0,
        });
        line.hours += item.hours;
        if item.outside {
            line.outside_hours += item.hours;
        }
    }

    pub fn finish(self) -> InvoiceSummary {
        let mut months: Vec<InvoiceMonth> = Vec::new();

        for ((month, ..), acc) in self.lines {
            let hours = round2(acc.hours);
            let rate = acc.base_rate.map(|r| r * acc.rate_percent / 100.0);
            let net_cents = rate.map_or(0, |rate| to_cents(hours * rate));
            let line = InvoiceLine {
                person: acc.person,
                service: acc.service,
                base_rate: acc.base_rate,
                rate_percent: acc.rate_percent,
                rate: rate.map(|r| (r * 10_000.0).round() / 10_000.0),
                hours,
                net: from_cents(net_cents),
                vat_percent: acc.vat_percent,
                outside_hours: round2(acc.outside_hours),
            };

            if months.last().is_none_or(|m| m.month != month) {
                months.push(InvoiceMonth {
                    partial: is_partial(&month, self.cutoff),
                    month,
                    lines: Vec::new(),
                    hours: 0.0,
                    net: 0.0,
                    vat_groups: Vec::new(),
                    vat: 0.0,
                    gross: 0.0,
                });
            }
            months.last_mut().expect("gerade angelegt").lines.push(line);
        }

        // Summen über alle Monate: USt.-Satz (fixiert) → (Netto, USt.) in Cent
        let mut total_groups: BTreeMap<i64, (f64, i64, i64)> = BTreeMap::new();
        let mut total_hours = 0.0;

        for month in &mut months {
            let mut groups: BTreeMap<i64, (f64, i64)> = BTreeMap::new();
            for line in &month.lines {
                let group = groups
                    .entry(fixed(line.vat_percent))
                    .or_insert((line.vat_percent, 0));
                group.1 += to_cents(line.net);
            }
            month.vat_groups = groups
                .into_values()
                .map(|(vat_percent, net_cents)| {
                    let vat_cents = (net_cents as f64 * vat_percent / 100.0).round() as i64;
                    let total =
                        total_groups
                            .entry(fixed(vat_percent))
                            .or_insert((vat_percent, 0, 0));
                    total.1 += net_cents;
                    total.2 += vat_cents;
                    VatGroup {
                        vat_percent,
                        net: from_cents(net_cents),
                        vat: from_cents(vat_cents),
                    }
                })
                .collect();

            let net_cents: i64 = month.lines.iter().map(|l| to_cents(l.net)).sum();
            let vat_cents: i64 = month.vat_groups.iter().map(|g| to_cents(g.vat)).sum();
            month.hours = round2(month.lines.iter().map(|l| l.hours).sum());
            month.net = from_cents(net_cents);
            month.vat = from_cents(vat_cents);
            month.gross = from_cents(net_cents + vat_cents);
            total_hours += month.hours;
        }

        let net_cents: i64 = total_groups.values().map(|g| g.1).sum();
        let vat_cents: i64 = total_groups.values().map(|g| g.2).sum();
        InvoiceSummary {
            vat_percent: self.vat_percent,
            months,
            total: InvoiceTotals {
                hours: round2(total_hours),
                net: from_cents(net_cents),
                vat_groups: total_groups
                    .into_values()
                    .map(|(vat_percent, net, vat)| VatGroup {
                        vat_percent,
                        net: from_cents(net),
                        vat: from_cents(vat),
                    })
                    .collect(),
                vat: from_cents(vat_cents),
                gross: from_cents(net_cents + vat_cents),
            },
        }
    }
}

/// Fließkommawert als Schlüssel (4 Nachkommastellen).
fn fixed(value: f64) -> i64 {
    (value * 10_000.0).round() as i64
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

    #[allow(clippy::too_many_arguments)]
    fn item<'a>(
        month: &str,
        person_index: usize,
        person: &'a str,
        rule_index: usize,
        service: &'a str,
        base_rate: Option<f64>,
        rate_percent: f64,
        vat_percent: f64,
        hours: f64,
    ) -> InvoiceItem<'a> {
        InvoiceItem {
            month: month.into(),
            person_index,
            person,
            rule_index,
            service,
            base_rate,
            rate_percent,
            vat_percent,
            hours,
            outside: false,
        }
    }

    #[test]
    fn groups_lines_and_computes_vat_per_rate() {
        let mut b = InvoiceBuilder::new(19.0, d(10, 15));
        // September: Erika mit Satzwechsel, Max mit Reisezeit zum halben Satz
        b.add(item(
            "2026-09",
            0,
            "Erika",
            0,
            "Delivery",
            Some(100.0),
            100.0,
            19.0,
            6.0,
        ));
        b.add(item(
            "2026-09",
            0,
            "Erika",
            0,
            "Delivery",
            Some(100.0),
            100.0,
            19.0,
            4.0,
        ));
        b.add(item(
            "2026-09",
            0,
            "Erika",
            0,
            "Delivery",
            Some(105.0),
            100.0,
            19.0,
            5.5,
        ));
        b.add(item(
            "2026-09",
            1,
            "Max",
            0,
            "Delivery",
            Some(90.0),
            100.0,
            19.0,
            8.0,
        ));
        b.add(item(
            "2026-09",
            1,
            "Max",
            1,
            "Reisezeit",
            Some(90.0),
            50.0,
            19.0,
            2.0,
        ));
        // Schulung mit 7 % USt.
        b.add(item(
            "2026-09",
            1,
            "Max",
            2,
            "Schulung",
            Some(90.0),
            100.0,
            7.0,
            3.0,
        ));
        // Oktober (Teilmonat), eine Position ohne Satz
        b.add(item(
            "2026-10",
            1,
            "Max",
            0,
            "Delivery",
            Some(95.0),
            100.0,
            19.0,
            1.0 / 3.0,
        ));
        b.add(item(
            "2026-10", 0, "Erika", 0, "Delivery", None, 100.0, 19.0, 4.0,
        ));

        let invoice = b.finish();
        assert_eq!(invoice.months.len(), 2);

        let sep = &invoice.months[0];
        assert!(!sep.partial);
        let lines: Vec<(&str, &str, Option<f64>, f64, f64)> = sep
            .lines
            .iter()
            .map(|l| {
                (
                    l.person.as_str(),
                    l.service.as_str(),
                    l.rate,
                    l.hours,
                    l.net,
                )
            })
            .collect();
        assert_eq!(
            lines,
            vec![
                ("Erika", "Delivery", Some(100.0), 10.0, 1000.0),
                ("Erika", "Delivery", Some(105.0), 5.5, 577.5),
                ("Max", "Delivery", Some(90.0), 8.0, 720.0),
                ("Max", "Reisezeit", Some(45.0), 2.0, 90.0),
                ("Max", "Schulung", Some(90.0), 3.0, 270.0),
            ]
        );
        assert_eq!(sep.net, 2657.5);
        assert_eq!(
            sep.vat_groups,
            vec![
                VatGroup {
                    vat_percent: 7.0,
                    net: 270.0,
                    vat: 18.9
                },
                VatGroup {
                    vat_percent: 19.0,
                    net: 2387.5,
                    vat: 453.63
                }, // 453,625 → 453,63
            ]
        );
        assert_eq!(sep.vat, 472.53);
        assert_eq!(sep.gross, 3130.03);

        let oct = &invoice.months[1];
        assert!(oct.partial);
        assert_eq!(oct.lines[0].person, "Erika"); // Team-Reihenfolge
        assert_eq!((oct.lines[0].rate, oct.lines[0].net), (None, 0.0));
        assert_eq!((oct.lines[1].hours, oct.lines[1].net), (0.33, 31.35));
        assert_eq!(oct.vat, 5.96);

        assert_eq!(invoice.total.net, 2688.85);
        assert_eq!(invoice.total.vat, 478.49);
        assert_eq!(invoice.total.gross, 3167.34);
        assert_eq!(invoice.total.vat_groups.len(), 2);
        assert_eq!(invoice.total.vat_groups[1].net, 2418.85);
        assert_eq!(invoice.total.vat_groups[1].vat, 459.59);
    }

    #[test]
    fn last_day_of_month_is_not_partial() {
        assert!(!is_partial("2026-10", d(10, 31)));
        assert!(is_partial("2026-10", d(10, 30)));
        assert!(!is_partial("2026-09", d(10, 15)));
        assert!(!is_partial("2026-02", d(2, 28)));
    }
}
