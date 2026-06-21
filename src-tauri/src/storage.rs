use std::path::Path;

use parking_lot::Mutex;
use rusqlite::{Connection, params};

use crate::types::ClipRecord;

pub struct ClipStore {
    connection: Mutex<Connection>,
}

impl ClipStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 CREATE TABLE IF NOT EXISTS clips (
                   id TEXT PRIMARY KEY,
                   path TEXT NOT NULL UNIQUE,
                   created_at TEXT NOT NULL,
                   duration_seconds REAL NOT NULL,
                   width INTEGER NOT NULL,
                   height INTEGER NOT NULL,
                   favorite INTEGER NOT NULL DEFAULT 0
                 );",
            )
            .map_err(|error| error.to_string())?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn insert(&self, clip: &ClipRecord) -> Result<(), String> {
        self.connection
            .lock()
            .execute(
                "INSERT INTO clips (id, path, created_at, duration_seconds, width, height, favorite)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    clip.id,
                    clip.path.to_string_lossy(),
                    clip.created_at,
                    clip.duration_seconds,
                    clip.width,
                    clip.height,
                    clip.favorite,
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<ClipRecord>, String> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id, path, created_at, duration_seconds, width, height, favorite
                 FROM clips ORDER BY created_at DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(ClipRecord {
                    id: row.get(0)?,
                    path: std::path::PathBuf::from(row.get::<_, String>(1)?),
                    created_at: row.get(2)?,
                    duration_seconds: row.get(3)?,
                    width: row.get(4)?,
                    height: row.get(5)?,
                    favorite: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }
}
