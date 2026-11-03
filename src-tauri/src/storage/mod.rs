pub mod imports;
pub mod projects;

use std::path::{Path, PathBuf};

/// Ordner neben der Programmdatei, z. B. `projects` oder `Import`.
pub fn beside_exe(exe: &Path, name: &str) -> PathBuf {
    exe.parent().unwrap_or_else(|| Path::new(".")).join(name)
}
