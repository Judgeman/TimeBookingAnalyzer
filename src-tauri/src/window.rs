//! Fenster an den Bildschirm anpassen: nach dem Wiederherstellen von Position
//! und Größe (und beim ersten Start) muss das Fenster vollständig im nutzbaren
//! Bereich eines Bildschirms liegen (ohne Taskleiste) – etwa wenn der große
//! Monitor fehlt oder die Auflösung kleiner ist.

use tauri::{Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// Rechteck in physischen Pixeln (Position = linke obere Ecke).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn right(&self) -> i64 {
        self.x as i64 + self.width as i64
    }

    fn bottom(&self) -> i64 {
        self.y as i64 + self.height as i64
    }

    /// Gemeinsame Fläche zweier Rechtecke.
    fn overlap(&self, other: &Rect) -> i64 {
        let width = self.right().min(other.right()) - (self.x.max(other.x) as i64);
        let height = self.bottom().min(other.bottom()) - (self.y.max(other.y) as i64);
        width.max(0) * height.max(0)
    }
}

/// Nutzbarer Bereich eines Bildschirms und sein Skalierungsfaktor.
#[derive(Debug, Clone, Copy)]
pub struct Screen {
    pub area: Rect,
    pub scale: f64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Fit {
    /// Passt – nichts ändern.
    Keep,
    /// Neue Position/Größe (äußeres Fenster inkl. Rahmen).
    Place(Rect),
    /// Bildschirm kleiner als die Mindestgröße: dorthin verschieben und maximieren.
    Maximize(Rect),
}

/// Bestimmt, wie das Fenster (äußeres Rechteck) auf den Bildschirm passt.
///
/// Bildschirm = der mit der größten Überdeckung; ohne Überdeckung (Monitor
/// fehlt) `fallback` (Hauptbildschirm), dort zentriert. Zu große Fenster werden
/// verkleinert, überstehende in den Bereich geschoben. Ist der Bereich kleiner
/// als die Mindestgröße (`min_inner` in logischen Pixeln + `decoration`), wird
/// maximiert.
pub fn fit(
    window: Rect,
    decoration: (u32, u32),
    min_inner: (f64, f64),
    screens: &[Screen],
    fallback: usize,
) -> Fit {
    if screens.is_empty() {
        return Fit::Keep;
    }
    let best = screens
        .iter()
        .enumerate()
        .map(|(i, s)| (i, window.overlap(&s.area)))
        .filter(|(_, overlap)| *overlap > 0)
        .max_by_key(|(_, overlap)| *overlap)
        .map(|(i, _)| i);
    let visible = best.is_some();
    let screen = screens[best.unwrap_or(fallback.min(screens.len() - 1))];
    let area = screen.area;

    let min_width = (min_inner.0 * screen.scale).ceil() as u32 + decoration.0;
    let min_height = (min_inner.1 * screen.scale).ceil() as u32 + decoration.1;
    if area.width < min_width || area.height < min_height {
        return Fit::Maximize(area);
    }

    let width = window.width.min(area.width);
    let height = window.height.min(area.height);
    let free_x = (area.width - width) as i32;
    let free_y = (area.height - height) as i32;
    let (x, y) = if visible {
        (
            window.x.clamp(area.x, area.x + free_x),
            window.y.clamp(area.y, area.y + free_y),
        )
    } else {
        (area.x + free_x / 2, area.y + free_y / 2)
    };
    let placed = Rect {
        x,
        y,
        width,
        height,
    };
    if placed == window {
        Fit::Keep
    } else {
        Fit::Place(placed)
    }
}

/// Wendet [`fit`] auf das Fenster an (maximierte/Vollbild-Fenster bleiben).
///
/// Solange das Fenster noch nicht angezeigt ist, liefern manche Systeme (GTK)
/// unsinnige Maße – dann passiert nichts; [`fit_to_screen_soon`] holt es nach.
pub fn fit_to_screen<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_fullscreen()? {
        return Ok(());
    }
    let position = window.outer_position()?;
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    let plausible = outer.width >= inner.width
        && outer.height >= inner.height
        && inner.width > 0
        && inner.height > 0
        && outer.width - inner.width < 200
        && outer.height - inner.height < 200;
    if !plausible {
        return Ok(());
    }
    let decoration = (
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    );
    // Mindestgröße wie in tauri.conf.json (minWidth/minHeight)
    let min_inner = window
        .app_handle()
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == window.label())
        .map(|w| (w.min_width.unwrap_or(0.0), w.min_height.unwrap_or(0.0)))
        .unwrap_or_default();

    let monitors = window.available_monitors()?;
    let screens: Vec<Screen> = monitors
        .iter()
        .map(|m| {
            let area = m.work_area();
            Screen {
                area: Rect {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width,
                    height: area.size.height,
                },
                scale: m.scale_factor(),
            }
        })
        .collect();
    let fallback = window
        .primary_monitor()?
        .and_then(|p| monitors.iter().position(|m| m.position() == p.position()))
        .unwrap_or(0);

    let current = Rect {
        x: position.x,
        y: position.y,
        width: outer.width,
        height: outer.height,
    };
    match fit(current, decoration, min_inner, &screens, fallback) {
        Fit::Keep => {}
        Fit::Place(rect) => {
            // erst verschieben (ggf. anderer Skalierungsfaktor), dann Größe setzen
            window.set_position(PhysicalPosition::new(rect.x, rect.y))?;
            window.set_size(PhysicalSize::new(
                rect.width - decoration.0,
                rect.height - decoration.1,
            ))?;
        }
        Fit::Maximize(area) => {
            window.set_position(PhysicalPosition::new(area.x, area.y))?;
            window.maximize()?;
        }
    }
    Ok(())
}

/// Passt das Fenster kurz nach dem Start (erneut) an – wenn es angezeigt ist
/// und seine Maße stimmen.
pub fn fit_to_screen_soon<R: Runtime>(window: WebviewWindow<R>) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let target = window.clone();
        let _ = window.run_on_main_thread(move || {
            let _ = fit_to_screen(&target);
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: (f64, f64) = (900.0, 600.0);

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    /// Laptop 1366 × 768 mit Taskleiste unten (nutzbar 1366 × 728).
    fn laptop() -> Screen {
        Screen {
            area: rect(0, 0, 1366, 728),
            scale: 1.0,
        }
    }

    fn place(window: Rect, screens: &[Screen]) -> Fit {
        fit(window, (0, 0), MIN, screens, 0)
    }

    #[test]
    fn keeps_windows_that_fit() {
        assert_eq!(place(rect(40, 20, 1000, 700), &[laptop()]), Fit::Keep);
        assert_eq!(place(rect(366, 28, 1000, 700), &[laptop()]), Fit::Keep); // genau am Rand
        assert_eq!(fit(rect(0, 0, 900, 600), (0, 0), MIN, &[], 0), Fit::Keep);
    }

    #[test]
    fn shrinks_windows_larger_than_the_screen() {
        // vom großen Monitor (2560 × 1400) auf den Laptop
        assert_eq!(
            place(rect(100, 50, 2560, 1400), &[laptop()]),
            Fit::Place(rect(0, 0, 1366, 728))
        );
        // Standardgröße 1280 × 820 zentriert → oben abgeschnitten
        assert_eq!(
            place(rect(43, -26, 1280, 820), &[laptop()]),
            Fit::Place(rect(43, 0, 1280, 728))
        );
    }

    #[test]
    fn moves_windows_back_onto_the_screen() {
        assert_eq!(
            place(rect(1200, 650, 1000, 700), &[laptop()]),
            Fit::Place(rect(366, 28, 1000, 700))
        );
        assert_eq!(
            place(rect(-950, -100, 1000, 700), &[laptop()]),
            Fit::Place(rect(0, 0, 1000, 700))
        );
    }

    #[test]
    fn centers_on_the_main_screen_when_the_monitor_is_gone() {
        let screens = [
            laptop(),
            Screen {
                area: rect(-1920, 0, 1920, 1040),
                scale: 1.0,
            },
        ];
        // gespeichert rechts auf einem Monitor, der fehlt → Hauptbildschirm (Index 0)
        assert_eq!(
            fit(rect(3000, 200, 1000, 700), (0, 0), MIN, &screens, 0),
            Fit::Place(rect(183, 14, 1000, 700))
        );
        // Index außerhalb → letzter Bildschirm
        assert_eq!(
            fit(rect(3000, 200, 1000, 700), (0, 0), MIN, &screens, 9),
            Fit::Place(rect(-1460, 170, 1000, 700))
        );
    }

    #[test]
    fn uses_the_screen_with_the_largest_overlap() {
        let left = Screen {
            area: rect(-1920, 0, 1920, 1040),
            scale: 1.0,
        };
        // überwiegend links, ragt nach unten heraus
        assert_eq!(
            fit(
                rect(-1500, 600, 1200, 700),
                (0, 0),
                MIN,
                &[laptop(), left],
                0
            ),
            Fit::Place(rect(-1500, 340, 1200, 700))
        );
        // Taskleiste oben: nutzbarer Bereich beginnt bei y = 40
        let top_bar = Screen {
            area: rect(0, 40, 1366, 728),
            scale: 1.0,
        };
        assert_eq!(
            place(rect(10, 0, 1000, 700), &[top_bar]),
            Fit::Place(rect(10, 40, 1000, 700))
        );
    }

    #[test]
    fn maximizes_when_the_screen_is_smaller_than_the_minimum_size() {
        let small = Screen {
            area: rect(0, 0, 1024, 560),
            scale: 1.0,
        };
        assert_eq!(
            place(rect(0, 0, 1000, 600), &[small]),
            Fit::Maximize(small.area)
        );
        // 150 %: Mindestbreite 900 logisch = 1350 physisch (+ Rahmen)
        let scaled = Screen {
            area: rect(0, 0, 1366, 728),
            scale: 1.5,
        };
        assert_eq!(
            fit(rect(0, 0, 1366, 728), (16, 39), MIN, &[scaled], 0),
            Fit::Maximize(scaled.area)
        );
        // mit Rahmen passt es bei 100 % noch
        assert_eq!(
            fit(rect(0, 0, 1000, 700), (16, 39), MIN, &[laptop()], 0),
            Fit::Keep
        );
    }
}
