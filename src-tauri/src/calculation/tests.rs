//! Szenario-Test mit von Hand nachgerechneten Werten (fiktive Daten).
//!
//! Zeitraum 01.01.–16.01.2026 (Hessen, 1.1. Feiertag). Arbeitszeit 8 h bis 09.01.,
//! danach 6 h. Erika: 100 € bis 09.01., danach 110 €. Max: Satz erst ab 05.01.
//! Abrechnung mit den Standardregeln (Delivery = billable h + €, übrige
//! „(billable)“ nur €, ohne Mult).

use chrono::NaiveDate;

use super::*;
use crate::models::config::{
    AssignmentPeriod, BillingRule, ExportFormat, HolidayConfig, MatchMode, ProjectConfig,
    RatePeriod, TeamMember, WorkingHoursPeriod, default_billing_rules,
};

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

fn rate(from: NaiveDate, to: Option<NaiveDate>, rate: f64) -> RatePeriod {
    RatePeriod { from, to, rate }
}

fn config() -> ProjectConfig {
    ProjectConfig {
        id: "test".into(),
        name: "Musterkunde GmbH / Lager-App".into(),
        element_filter: "P100 Lager-App".into(),
        team: vec![
            TeamMember {
                name: "Erika Mustermann".into(),
                rates: vec![
                    rate(d(2026, 1, 1), Some(d(2026, 1, 9)), 100.0),
                    rate(d(2026, 1, 10), None, 110.0),
                ],
                working_hours: vec![],
                assignments: vec![],
            },
            TeamMember {
                name: "Max Mustermann".into(),
                rates: vec![rate(d(2026, 1, 5), None, 90.0)],
                working_hours: vec![],
                assignments: vec![],
            },
        ],
        working_hours: vec![
            WorkingHoursPeriod {
                from: d(2026, 1, 1),
                to: Some(d(2026, 1, 9)),
                hours_per_day: 8.0,
            },
            WorkingHoursPeriod {
                from: d(2026, 1, 10),
                to: None,
                hours_per_day: 6.0,
            },
        ],
        holidays: HolidayConfig::default(),
        export_format: ExportFormat::default(),
        vat_percent: 19.0,
        billing_rules: default_billing_rules(),
        missing_threshold_percent: 50.0,
    }
}

fn e(
    name: &str,
    date: NaiveDate,
    hours: f64,
    mult: f64,
    element: &str,
    kost2art: &str,
) -> TimeEntry {
    TimeEntry {
        name: name.into(),
        date,
        hours,
        mult,
        element: element.into(),
        kost2art: kost2art.into(),
        location: String::new(),
    }
}

const ERIKA: &str = "Erika Mustermann";
const P100: &str = "P100 Lager-App";
const DELIVERY: &str = "Delivery (billable)";

fn entries() -> Vec<TimeEntry> {
    vec![
        e(ERIKA, d(2025, 12, 30), 8.0, 1.0, P100, DELIVERY), // Vorjahr → ignoriert
        e(ERIKA, d(2026, 1, 1), 8.0, 1.0, "(Vacation)", ""), // Feiertag → zählt, hervorgehoben
        e(ERIKA, d(2026, 1, 2), 8.0, 1.0, P100, DELIVERY),
        e(ERIKA, d(2026, 1, 5), 8.0, 1.0, "(Vacation)", ""),
        e(ERIKA, d(2026, 1, 6), 6.0, 1.0, P100, DELIVERY),
        e(ERIKA, d(2026, 1, 6), 2.0, 0.5, P100, "Travel (billable)"),
        e(ERIKA, d(2026, 1, 7), 7.0, 1.0, P100, DELIVERY),
        e(ERIKA, d(2026, 1, 7), 1.0, 1.0, "Z900 Intern", "Internal"),
        e(ERIKA, d(2026, 1, 10), 3.0, 1.0, P100, DELIVERY), // Samstag
        e(ERIKA, d(2026, 1, 12), 8.0, 1.0, "(Sick)", ""),
        e(ERIKA, d(2026, 1, 13), 6.0, 1.0, P100, "Sales"),
        e(ERIKA, d(2026, 1, 14), 4.0, 0.0, P100, DELIVERY), // Mult 0
        e(ERIKA, d(2026, 1, 17), 5.0, 1.0, P100, DELIVERY), // nach Stichtag
        e("max mustermann ", d(2026, 1, 2), 8.0, 1.0, P100, DELIVERY), // ohne Satz
        e("Max Mustermann", d(2026, 1, 5), 8.0, 1.0, P100, DELIVERY),
        e(
            "Jonas Beispiel",
            d(2026, 1, 5),
            8.0,
            1.0,
            "P200 Intranet",
            DELIVERY,
        ), // nicht im Team
    ]
}

fn run() -> Evaluation {
    evaluate(&config(), &entries(), d(2026, 1, 16), Some(d(2026, 1, 16)))
}

#[test]
fn year_to_date_per_person() {
    let result = run();
    assert_eq!(result.period_start, d(2026, 1, 1));
    assert_eq!(result.persons.len(), 2);

    let erika = &result.persons[0].periods.ytd;
    // Werktage: 02.01. + 05.–09.01. à 8 h = 48 h, 12.–16.01. à 6 h = 30 h
    assert_eq!(erika.soll_b, 78.0);
    // Urlaub 01.01. (Feiertag, zählt trotzdem) + 05.01. à 8 h
    assert_eq!((erika.vac_days, erika.vac_h), (2.0, 16.0));
    assert_eq!((erika.sick_days, erika.sick_h), (1.0, 6.0)); // 8 h Personio → 6 h Vertrag
    assert_eq!(erika.soll_n, 56.0);
    assert_eq!(erika.gearb, 32.0); // 8 + (6 + 2×0,5) + (7 + 1) + 3 + 6 + 0
    assert_eq!(erika.bill_h, 28.0); // 8 + 6 + 7 + 3 + 4
    assert_eq!(erika.nonbill_h, 9.0); // Travel 2 + Intern 1 + Sales 6
    assert_eq!(erika.bill_eur, 3070.0); // (8+8+7)×100 + (3+4)×110
    assert_eq!(erika.plus, -24.0);
    assert_eq!(erika.plus_krank, -30.0);

    let max = &result.persons[1].periods.ytd;
    assert_eq!(max.soll_b, 78.0);
    assert_eq!(max.gearb, 16.0);
    assert_eq!(max.bill_h, 16.0);
    assert_eq!(max.bill_eur, 720.0); // 02.01. ohne Satz
    assert_eq!(max.plus, -62.0);

    let team = &result.team.ytd;
    assert_eq!(team.soll_b, 156.0);
    assert_eq!(team.gearb, 48.0);
    assert_eq!(team.bill_eur, 3790.0);
}

#[test]
fn months_and_calendar_weeks() {
    let result = run();
    let erika = &result.persons[0].periods;
    assert_eq!(erika.by_month.keys().collect::<Vec<_>>(), vec!["2026-01"]);
    assert_eq!(erika.by_month["2026-01"], erika.ytd);

    assert_eq!(
        erika.by_week.keys().collect::<Vec<_>>(),
        vec!["2026-W01", "2026-W02", "2026-W03"]
    );
    let w01 = &erika.by_week["2026-W01"]; // 01.–04.01.: Urlaub am Feiertag + 02.01.
    assert_eq!(
        (w01.soll_b, w01.vac_h, w01.gearb, w01.plus),
        (8.0, 8.0, 8.0, 8.0)
    );
    let w02 = &erika.by_week["2026-W02"]; // 05.–11.01. inkl. Samstag
    assert_eq!(w02.soll_b, 40.0);
    assert_eq!(w02.vac_h, 8.0);
    assert_eq!(w02.gearb, 18.0);
    assert_eq!(w02.bill_h, 16.0);
    assert_eq!(w02.plus, -14.0);

    assert_eq!(result.persons[0].periods.month_weeks["2026-01"].len(), 3);
    assert_eq!(result.team.by_week["2026-W02"].soll_b, 80.0);
}

#[test]
fn invoice_per_month() {
    let invoice = run().invoice;
    assert_eq!(invoice.months.len(), 1);
    let jan = &invoice.months[0];
    assert_eq!(jan.month, "2026-01");
    assert!(jan.partial);

    let lines: Vec<(&str, &str, Option<f64>, f64, f64)> = jan
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
            (ERIKA, "Delivery", Some(100.0), 21.0, 2100.0),
            (ERIKA, "Delivery", Some(110.0), 7.0, 770.0),
            (
                ERIKA,
                "Sonstige billable (z. B. Travel)",
                Some(100.0),
                2.0,
                200.0
            ),
            ("Max Mustermann", "Delivery", None, 8.0, 0.0),
            ("Max Mustermann", "Delivery", Some(90.0), 8.0, 720.0),
        ]
    );
    assert_eq!(jan.net, 3790.0);
    assert_eq!(jan.vat, 720.1);
    assert_eq!(jan.gross, 4510.1);
    assert_eq!(invoice.total.gross, 4510.1);
}

#[test]
fn custom_rule_with_mult_reduced_rate_and_own_vat() {
    let mut config = config();
    config.billing_rules.insert(
        0,
        BillingRule {
            name: "Reisezeit".into(),
            kost2art: "travel".into(),
            match_mode: MatchMode::Contains,
            element: String::new(),
            billable_hours: false,
            invoice: true,
            apply_mult: true,
            rate_percent: 50.0,
            vat_percent: Some(7.0),
        },
    );
    let result = evaluate(&config, &entries(), d(2026, 1, 16), None);

    // Reisezeit 06.01.: 2 h × Mult 0,5 = 1 h × 100 € × 50 % = 50 €
    let erika = &result.persons[0].periods.ytd;
    assert_eq!(erika.bill_eur, 2920.0);
    assert_eq!(erika.bill_h, 28.0);

    let jan = &result.invoice.months[0];
    let travel = jan.lines.iter().find(|l| l.service == "Reisezeit").unwrap();
    assert_eq!(
        (
            travel.hours,
            travel.base_rate,
            travel.rate,
            travel.net,
            travel.vat_percent
        ),
        (1.0, Some(100.0), Some(50.0), 50.0, 7.0)
    );
    let groups: Vec<(f64, f64, f64)> = jan
        .vat_groups
        .iter()
        .map(|g| (g.vat_percent, g.net, g.vat))
        .collect();
    assert_eq!(groups, vec![(7.0, 50.0, 3.5), (19.0, 3590.0, 682.1)]);
    assert_eq!((jan.net, jan.vat, jan.gross), (3640.0, 685.6, 4325.6));
}

#[test]
fn rules_can_make_other_kost2art_billable_or_exclude_it() {
    let mut config = config();
    // Sales zählt als billable Stunden, wird aber nicht abgerechnet;
    // Travel wird gar nicht mehr abgerechnet (keine passende Regel).
    config.billing_rules = vec![
        default_billing_rules()[0].clone(),
        BillingRule {
            name: "Sales".into(),
            kost2art: "Sales".into(),
            match_mode: MatchMode::Exact,
            element: String::new(),
            billable_hours: true,
            invoice: false,
            apply_mult: false,
            rate_percent: 100.0,
            vat_percent: None,
        },
    ];
    let erika = evaluate(&config, &entries(), d(2026, 1, 16), None).persons[0]
        .periods
        .ytd;
    assert_eq!(erika.bill_h, 34.0); // 28 + Sales 6
    assert_eq!(erika.nonbill_h, 3.0); // Travel 2 + Intern 1
    assert_eq!(erika.bill_eur, 2870.0); // ohne Travel
}

#[test]
fn person_working_hours_override_project() {
    let mut config = config();
    config.team[1].working_hours = vec![WorkingHoursPeriod {
        from: d(2026, 1, 12),
        to: None,
        hours_per_day: 4.0,
    }];
    let result = evaluate(&config, &entries(), d(2026, 1, 16), None);
    assert_eq!(result.persons[0].periods.ytd.soll_b, 78.0);
    assert_eq!(result.persons[1].periods.ytd.soll_b, 68.0); // 6 × 8 h + 5 × 4 h
}

#[test]
fn absences_are_counted_on_any_day_and_flagged() {
    let mut entries = entries();
    entries.push(e("Max Mustermann", d(2026, 1, 14), 6.0, 1.0, "(Sick)", ""));
    let result = evaluate(&config(), &entries, d(2026, 1, 16), None);

    let flagged: Vec<(&str, NaiveDate, f64, f64, String)> = result
        .flagged
        .iter()
        .map(|f| {
            (
                f.person.as_str(),
                f.date,
                f.credited_days,
                f.credited_hours,
                f.reasons.join("; "),
            )
        })
        .collect();
    assert_eq!(
        flagged,
        vec![
            (
                ERIKA,
                d(2026, 1, 1),
                1.0,
                8.0,
                "Feiertag (Neujahr)".to_string()
            ),
            (
                "Max Mustermann",
                d(2026, 1, 14),
                1.0,
                6.0,
                "6,00 h gebucht → als 1,00 Tag(e) angerechnet".to_string()
            ),
        ]
    );
    assert_eq!(result.flagged[0].kind, AbsenceKind::Vacation);
    let max = &result.persons[1].periods.ytd;
    assert_eq!((max.sick_days, max.sick_h), (1.0, 6.0));
    assert_eq!((max.plus, max.plus_krank), (-56.0, -62.0));
}

#[test]
fn warnings_explain_ignored_data() {
    let warnings = evaluate(&config(), &entries(), d(2026, 1, 16), Some(d(2026, 1, 14)))
        .warnings
        .join("\n");
    assert!(
        warnings.contains("1 Buchung(en) des Teams nach dem Stichtag 16.01.2026"),
        "{warnings}"
    );
    assert!(
        warnings.contains("Max Mustermann: kein Stundensatz für 8,00 billable Stunden zwischen 02.01.2026 und 02.01.2026"),
        "{warnings}"
    );
    assert!(
        warnings.contains("Stichtag 16.01.2026 liegt nach dem Stand des Exports (14.01.2026)"),
        "{warnings}"
    );
    assert!(!warnings.contains("Arbeitszeit"), "{warnings}");
    assert!(
        run()
            .warnings
            .iter()
            .all(|w| !w.contains("Stand des Exports"))
    );
}

#[test]
fn missing_working_hours_are_reported_once_or_per_person() {
    let mut config = config();
    config.working_hours[0].from = d(2026, 1, 5);
    let result = evaluate(&config, &entries(), d(2026, 1, 16), None);
    assert_eq!(result.persons[0].periods.ytd.soll_b, 70.0);
    let warnings = result.warnings.join("\n");
    assert!(
        warnings.contains("Alle Personen: für 1 Werktag(e) zwischen 02.01.2026 und 02.01.2026 ist keine Arbeitszeit"),
        "{warnings}"
    );

    config.team[1].working_hours = vec![WorkingHoursPeriod {
        from: d(2026, 1, 1),
        to: Some(d(2026, 1, 4)),
        hours_per_day: 8.0,
    }];
    let warnings = evaluate(&config, &entries(), d(2026, 1, 16), None)
        .warnings
        .join("\n");
    assert!(
        warnings.contains("Erika Mustermann: für 1 Werktag(e)"),
        "{warnings}"
    );
    assert!(!warnings.contains("Max Mustermann: für"), "{warnings}");
}

#[test]
fn holidays_follow_region_and_year_of_cutoff() {
    let result = run();
    assert_eq!(result.holidays.first().map(|h| h.date), Some(d(2026, 1, 1)));
    assert_eq!(result.holidays.len(), 10);
}

#[test]
fn week_keys_use_iso_week_year() {
    assert_eq!(week_key(d(2026, 1, 1)), "2026-W01");
    assert_eq!(week_key(d(2027, 1, 1)), "2026-W53");
    assert_eq!(week_key(d(2026, 10, 19)), "2026-W43");
    assert_eq!(month_key(d(2026, 3, 9)), "2026-03");
}

#[test]
fn hours_per_work_location() {
    let mut entries = entries();
    let set =
        |entries: &mut Vec<TimeEntry>, day: u32, kost2art: &str, element: &str, location: &str| {
            let entry = entries
                .iter_mut()
                .find(|e| {
                    e.name == ERIKA
                        && e.date == d(2026, 1, day)
                        && e.kost2art == kost2art
                        && e.element == element
                })
                .unwrap();
            entry.location = location.into();
        };
    set(&mut entries, 2, DELIVERY, P100, "Home Office");
    set(&mut entries, 6, DELIVERY, P100, "Kunde");
    set(&mut entries, 6, "Travel (billable)", P100, "Kunde"); // 2 h × Mult 0,5
    set(&mut entries, 7, DELIVERY, P100, "home office ");
    set(&mut entries, 7, "Internal", "Z900 Intern", "Büro");
    set(&mut entries, 10, DELIVERY, P100, "Home Office");
    set(&mut entries, 14, DELIVERY, P100, "Home Office"); // Mult 0 → zählt nicht
    let result = evaluate(&config(), &entries, d(2026, 1, 16), None);

    let erika = &result.persons[0].periods;
    let shares: Vec<(&str, f64, f64, usize)> = erika
        .locations
        .ytd
        .iter()
        .map(|s| (s.location.as_str(), s.hours, s.share, s.days))
        .collect();
    assert_eq!(
        shares,
        vec![
            ("Home Office", 18.0, 56.25, 3),
            ("Kunde", 7.0, 21.88, 1),
            ("(ohne Angabe)", 6.0, 18.75, 1),
            ("Büro", 1.0, 3.13, 1),
        ]
    );
    let total: f64 = erika.locations.ytd.iter().map(|s| s.hours).sum();
    assert_eq!(total, erika.ytd.gearb);
    assert_eq!(erika.locations.by_month["2026-01"], erika.locations.ytd);

    let team_unknown = result
        .team
        .locations
        .ytd
        .iter()
        .find(|s| s.location == "(ohne Angabe)")
        .unwrap();
    assert_eq!((team_unknown.hours, team_unknown.days), (22.0, 3)); // Erika 6 h + Max 16 h
}

#[test]
fn missing_bookings_below_threshold() {
    let result = run(); // geprüft bis 16.01. (Stand des Exports)
    assert_eq!(result.missing_checked_until, d(2026, 1, 16));

    let erika: Vec<(NaiveDate, f64, f64, f64)> = result
        .missing
        .iter()
        .filter(|m| m.person == ERIKA)
        .map(|m| (m.date, m.expected_hours, m.booked_hours, m.coverage_percent))
        .collect();
    // 05.01. Urlaub, 12.01. krank, 13.01. Sales 6/6 h, 14.01. 4/6 h (Mult 0 zählt als gebucht)
    assert_eq!(
        erika,
        vec![
            (d(2026, 1, 8), 8.0, 0.0, 0.0),
            (d(2026, 1, 9), 8.0, 0.0, 0.0),
            (d(2026, 1, 15), 6.0, 0.0, 0.0),
            (d(2026, 1, 16), 6.0, 0.0, 0.0),
        ]
    );
    let periods = &result.persons[0].periods;
    assert_eq!(periods.ytd.missing_days, 4.0);
    assert_eq!(periods.by_week["2026-W02"].missing_days, 2.0);
    assert_eq!(periods.by_week["2026-W03"].missing_days, 2.0);
    // Max bucht nur am 02. und 05.01.
    assert_eq!(result.persons[1].periods.ytd.missing_days, 9.0);
    assert_eq!(result.team.ytd.missing_days, 13.0);
}

#[test]
fn missing_bookings_respect_partial_bookings_threshold_and_export_date() {
    let mut entries = entries();
    entries.push(e(ERIKA, d(2026, 1, 15), 2.0, 1.0, P100, DELIVERY)); // 2 von 6 h
    entries.push(e(ERIKA, d(2026, 1, 16), 3.0, 1.0, P100, DELIVERY)); // genau 50 %
    let mut cfg = config();
    let result = evaluate(&cfg, &entries, d(2026, 1, 16), Some(d(2026, 1, 16)));
    let erika: Vec<(NaiveDate, f64)> = result
        .missing
        .iter()
        .filter(|m| m.person == ERIKA)
        .map(|m| (m.date, m.coverage_percent))
        .collect();
    assert_eq!(
        erika,
        vec![
            (d(2026, 1, 8), 0.0),
            (d(2026, 1, 9), 0.0),
            (d(2026, 1, 15), 33.33)
        ]
    );

    // Schwelle 70 %: 14.01. (4 von 6 h = 66,67 %) fehlt jetzt auch
    cfg.missing_threshold_percent = 70.0;
    let result = evaluate(&cfg, &entries, d(2026, 1, 16), Some(d(2026, 1, 16)));
    assert!(
        result
            .missing
            .iter()
            .any(|m| m.person == ERIKA && m.date == d(2026, 1, 14) && m.coverage_percent == 66.67)
    );

    // Stichtag nach dem Export-Stand: nur bis zum Stand prüfen
    let result = evaluate(&config(), &entries, d(2026, 1, 16), Some(d(2026, 1, 9)));
    assert_eq!(result.missing_checked_until, d(2026, 1, 9));
    let dates: Vec<NaiveDate> = result
        .missing
        .iter()
        .filter(|m| m.person == ERIKA)
        .map(|m| m.date)
        .collect();
    assert_eq!(dates, vec![d(2026, 1, 8), d(2026, 1, 9)]);
}

#[test]
fn assignment_period_limits_person_but_project_bookings_are_still_billed() {
    // Max ist nur am 01./02.01. im Projekt; am 05.01. bucht er trotzdem aufs Projekt.
    let mut config = config();
    config.team[1].assignments = vec![AssignmentPeriod {
        from: d(2026, 1, 1),
        to: Some(d(2026, 1, 2)),
    }];
    let mut entries = entries();
    entries.push(e(
        "Max Mustermann",
        d(2026, 1, 6),
        3.0,
        1.0,
        "P200 Intranet",
        DELIVERY,
    )); // anderes Projekt
    entries.push(e(
        "Max Mustermann",
        d(2026, 1, 12),
        8.0,
        1.0,
        "(Vacation)",
        "",
    )); // außerhalb → ignoriert
    entries.push(e("Lena Fremd", d(2026, 1, 7), 2.0, 1.0, P100, DELIVERY)); // nicht im Team
    let result = evaluate(&config, &entries, d(2026, 1, 16), Some(d(2026, 1, 16)));

    let max = &result.persons[1];
    assert_eq!(max.assignments.len(), 1);
    let ytd = &max.periods.ytd;
    assert_eq!(ytd.soll_b, 8.0); // nur 02.01. (01.01. Feiertag)
    assert_eq!(ytd.gearb, 8.0); // nur 02.01.
    assert_eq!(ytd.vac_h, 0.0);
    assert_eq!(ytd.missing_days, 0.0); // vorher 9 Tage
    assert_eq!(ytd.nonbill_h, 0.0); // P200 am 06.01. zählt nicht
    assert_eq!(ytd.bill_h, 16.0); // 02.01. + 05.01. (außerhalb, aber aufs Projekt)
    assert_eq!(ytd.bill_eur, 720.0); // 05.01.: 8 h × 90 €
    assert_eq!(
        max.periods
            .locations
            .ytd
            .iter()
            .map(|l| l.hours)
            .sum::<f64>(),
        8.0
    );
    assert!(!result.flagged.iter().any(|f| f.person == "Max Mustermann"));

    // Rechnung: Position mit Hinweis auf Stunden außerhalb des Einsatzzeitraums
    let jan = &result.invoice.months[0];
    let line = jan
        .lines
        .iter()
        .find(|l| l.person == "Max Mustermann" && l.rate == Some(90.0))
        .unwrap();
    assert_eq!(
        (line.hours, line.outside_hours, line.net),
        (8.0, 8.0, 720.0)
    );
    assert_eq!(jan.net, 3790.0); // unverändert: abgerechnet wird trotzdem

    let outside: Vec<(&str, NaiveDate, OutsideReason, bool, f64, f64)> = result
        .outside
        .iter()
        .map(|o| {
            (
                o.person.as_str(),
                o.date,
                o.reason,
                o.invoiced,
                o.billed_hours,
                o.net,
            )
        })
        .collect();
    assert_eq!(
        outside,
        vec![
            (
                "Max Mustermann",
                d(2026, 1, 5),
                OutsideReason::OutsideAssignment,
                true,
                8.0,
                720.0
            ),
            (
                "Lena Fremd",
                d(2026, 1, 7),
                OutsideReason::NotInTeam,
                false,
                0.0,
                0.0
            ),
        ]
    );
    // Team-Summen ohne Max' Zeit außerhalb
    assert_eq!(result.team.ytd.soll_b, 78.0 + 8.0);
}
