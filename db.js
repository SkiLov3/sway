const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data', 'sway.db');

let db;

function getDb(customPath) {
  if (!db || customPath) {
    const fs = require('fs');
    const dbPath = customPath || DB_PATH;
    
    // Only create directory if using default path
    if (!customPath) {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    }
    
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL'); // Safe with WAL, improves performance
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function resetDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      federation TEXT DEFAULT '',
      status TEXT DEFAULT 'setup',
      plates_config TEXT DEFAULT '{}',
      short_code TEXT COLLATE NOCASE DEFAULT '',
      decision_display_seconds INTEGER DEFAULT 15,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS divisions (
      id TEXT PRIMARY KEY,
      meet_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (meet_id) REFERENCES meets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS weight_classes (
      id TEXT PRIMARY KEY,
      division_id TEXT NOT NULL,
      name TEXT NOT NULL,
      max_weight REAL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lifters (
      id TEXT PRIMARY KEY,
      meet_id TEXT NOT NULL,
      name TEXT NOT NULL,
      team TEXT DEFAULT '',
      division_id TEXT,
      weight_class_id TEXT,
      gender TEXT DEFAULT 'M' CHECK(gender IN ('M', 'F', 'X')),
      body_weight REAL,
      lot_number INTEGER,
      flight TEXT DEFAULT 'A',
      platform INTEGER DEFAULT 1,
      rack_height TEXT DEFAULT '',
      bench_rack_height TEXT DEFAULT '',
      squat_rack_height TEXT DEFAULT '',
      bench_safety_height TEXT DEFAULT '4',
      bench_blocks TEXT DEFAULT 'N',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (meet_id) REFERENCES meets(id) ON DELETE CASCADE,
      FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL,
      FOREIGN KEY (weight_class_id) REFERENCES weight_classes(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lifters_meet_id ON lifters(meet_id);

    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      lifter_id TEXT NOT NULL,
      lift_type TEXT NOT NULL CHECK(lift_type IN ('squat', 'bench', 'deadlift')),
      attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 4),
      weight REAL,
      result TEXT DEFAULT 'pending' CHECK(result IN ('good', 'no_good', 'pending', 'skipped')),
      ref1 TEXT DEFAULT '' CHECK(ref1 IN ('', 'white', 'red')),
      ref2 TEXT DEFAULT '' CHECK(ref2 IN ('', 'white', 'red')),
      ref3 TEXT DEFAULT '' CHECK(ref3 IN ('', 'white', 'red')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(lifter_id, lift_type, attempt_number),
      FOREIGN KEY (lifter_id) REFERENCES lifters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_attempts_lifter_id ON attempts(lifter_id);

    CREATE TABLE IF NOT EXISTS meet_state (
      meet_id TEXT PRIMARY KEY,
      current_platform INTEGER DEFAULT 1,
      current_lift_type TEXT DEFAULT 'squat',
      current_attempt_number INTEGER DEFAULT 1,
      current_flight TEXT DEFAULT 'A',
      current_lifter_id TEXT DEFAULT '',
      clock_seconds INTEGER DEFAULT 60,
      clock_running INTEGER DEFAULT 0,
      round_number INTEGER DEFAULT 1,
      FOREIGN KEY (meet_id) REFERENCES meets(id) ON DELETE CASCADE
    );
  `);

  // ── Versioned migrations ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const appliedVersions = new Set(
    db.prepare('SELECT version FROM schema_versions').all().map(r => r.version)
  );

  const migrations = [
    {
      version: 1,
      description: 'Add gender column to lifters',
      sql: "ALTER TABLE lifters ADD COLUMN gender TEXT DEFAULT 'M' CHECK(gender IN ('M', 'F', 'X'))",
    },
    {
      version: 2,
      description: 'Add short_code to meets',
      sql: "ALTER TABLE meets ADD COLUMN short_code TEXT DEFAULT ''; CREATE UNIQUE INDEX IF NOT EXISTS idx_meets_short_code ON meets(short_code) WHERE short_code != '';",
    },
    {
      version: 3,
      description: 'Add decision_display_seconds to meets',
      sql: "ALTER TABLE meets ADD COLUMN decision_display_seconds INTEGER DEFAULT 15",
    },
    {
      version: 4,
      description: 'Add bench_safety_height to lifters',
      sql: "ALTER TABLE lifters ADD COLUMN bench_safety_height TEXT DEFAULT '4'",
    },
    {
      version: 5,
      description: 'Add bench_blocks to lifters',
      sql: "ALTER TABLE lifters ADD COLUMN bench_blocks TEXT DEFAULT 'N'",
    },
    // Add future migrations here: { version: N, description: '...', sql: '...' }
  ];

  for (const m of migrations) {
    if (appliedVersions.has(m.version)) continue;
    try {
      db.exec(m.sql);
      db.prepare('INSERT OR IGNORE INTO schema_versions (version) VALUES (?)').run(m.version);
      console.log(`[DB] Applied migration v${m.version}: ${m.description}`);
    } catch (e) {
      // 'duplicate column name' means it was already applied before version tracking
      if (!e.message.includes('duplicate column name')) {
        console.warn(`[DB] Migration v${m.version} warning: ${e.message}`);
      }
      db.prepare('INSERT OR IGNORE INTO schema_versions (version) VALUES (?)').run(m.version);
    }
  }
}

function generateId() {
  return uuidv4();
}

module.exports = { getDb, generateId, resetDb };
