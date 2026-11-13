pub mod forecasts;
pub mod imports;
pub mod projectforge;
pub mod projects;
pub mod settings;

use std::path::{Path, PathBuf};

/// Ordner neben der Programmdatei, z. B. `projects` oder `Import`.
pub fn beside_exe(exe: &Path, name: &str) -> PathBuf {
    exe.parent().unwrap_or_else(|| Path::new(".")).join(name)
}
