//! Übersicht über einen eingelesenen Export (vor der eigentlichen Auswertung).

use std::collections::BTreeMap;

use chrono::NaiveDate;

use super::export::ParseOutcome;
use crate::calculation::round2;
use crate::models::config::ProjectConfig;
use crate::models::results::{ParsedExport, PersonOverview};

/// Anzahl der Einträge, die zur Kontrolle an die UI gehen.
const PREVIEW_ROWS: usize = 25;

pub fn summarize(
    config: &ProjectConfig,
    file_name: String,
    export_date: Option<NaiveDate>,
    outcome: ParseOutcome,
) -> ParsedExport {
    let entries = &outcome.entries;
    let in_team = |name: &str| config.team_index(name).is_some();
    let is_project =
        |element: &str| !config.element_filter.is_empty() && element == config.element_filter;

    #[derive(Default)]
    struct Acc {
        entries: usize,
        hours: f64,
        project_hours: f64,
    }
    let mut by_person: BTreeMap<&str, Acc> = BTreeMap::new();
    for entry in entries {
        let acc = by_person.entry(entry.name.as_str()).or_default();
        acc.entries += 1;
        acc.hours += entry.hours;
        if is_project(&entry.element) {
            acc.project_hours += entry.hours;
        }
    }

    let mut persons: Vec<PersonOverview> = by_person
        .into_iter()
        .map(|(name, acc)| PersonOverview {
            name: name.to_string(),
            in_team: in_team(name),
            entry_count: acc.entries,
            hours: round2(acc.hours),
            project_hours: round2(acc.project_hours),
        })
        .collect();
    // Teammitglieder zuerst, dann alphabetisch (BTreeMap liefert bereits sortiert).
    persons.sort_by_key(|p| !p.in_team);

    let missing_team_members = config
        .team
        .iter()
        .enumerate()
        .filter(|(i, _)| {
            !entries
                .iter()
                .any(|e| config.team_index(&e.name) == Some(*i))
        })
        .map(|(_, m)| m.name.clone())
        .collect();

    ParsedExport {
        project_id: config.id.clone(),
        project_name: config.name.clone(),
        file_name,
        sheet_name: outcome.sheet_name,
        export_date,
        first_entry_date: entries.iter().map(|e| e.date).min(),
        last_entry_date: entries.iter().map(|e| e.date).max(),
        entry_count: entries.len(),
        total_hours: round2(entries.iter().map(|e| e.hours).sum()),
        element_match_count: entries.iter().filter(|e| is_project(&e.element)).count(),
        persons,
        missing_team_members,
        skipped_rows: outcome.skipped,
        preview: entries.iter().take(PREVIEW_ROWS).cloned().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::config::{ExportFormat, HolidayConfig, TeamMember, default_billing_rules};
    use crate::models::entry::TimeEntry;
    use crate::models::results::SkippedRow;

    fn entry(name: &str, day: u32, hours: f64, element: &str) -> TimeEntry {
        TimeEntry {
            name: name.into(),
            date: NaiveDate::from_ymd_opt(2026, 10, day).unwrap(),
            hours,
            mult: 1.0,
            element: element.into(),
            kost2art: "Delivery (billable)".into(),
            location: String::new(),
        }
    }

    fn member(name: &str) -> TeamMember {
        TeamMember {
            name: name.into(),
            rates: vec![],
            working_hours: vec![],
            assignments: vec![],
        }
    }

    #[test]
    fn builds_person_overview_and_team_check() {
        let config = ProjectConfig {
            id: "p1".into(),
            name: "Lager-App".into(),
            element_filter: "P100 Lager-App".into(),
            team: vec![
                member("Erika Mustermann"),
                member("Max Mustermann"),
                member("Neu Person"),
            ],
            working_hours: vec![],
            holidays: HolidayConfig::default(),
            export_format: ExportFormat::default(),
            vat_percent: 19.0,
            billing_rules: default_billing_rules(),
            missing_threshold_percent: 50.0,
        };
        let outcome = ParseOutcome {
            sheet_name: "Details".into(),
            entries: vec![
                entry("Erika Mustermann", 5, 7.5, "P100 Lager-App"),
                entry("Zoe Extern", 6, 3.0, "Anderes Projekt"),
                entry("erika mustermann", 6, 1.111, "Intern"),
                entry("Max Mustermann", 2, 8.0, "P100 Lager-App"),
            ],
            skipped: vec![SkippedRow {
                row: 9,
                reason: "x".into(),
            }],
        };

        let result = summarize(&config, "export.xlsx".into(), None, outcome);

        assert_eq!(result.entry_count, 4);
        assert_eq!(result.element_match_count, 2);
        assert_eq!(result.total_hours, 19.61);
        assert_eq!(
            result.first_entry_date,
            NaiveDate::from_ymd_opt(2026, 10, 2)
        );
        assert_eq!(result.last_entry_date, NaiveDate::from_ymd_opt(2026, 10, 6));
        assert_eq!(result.missing_team_members, vec!["Neu Person".to_string()]);
        assert_eq!(result.skipped_rows.len(), 1);

        let names: Vec<(&str, bool)> = result
            .persons
            .iter()
            .map(|p| (p.name.as_str(), p.in_team))
            .collect();
        assert_eq!(
            names,
            vec![
                ("Erika Mustermann", true),
                ("Max Mustermann", true),
                ("erika mustermann", true),
                ("Zoe Extern", false)
            ]
        );
        assert_eq!(result.persons[0].project_hours, 7.5);
        assert_eq!(result.persons[2].hours, 1.11);
    }
}
