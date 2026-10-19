const Database = require('better-sqlite3');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

let db;
let isInitialized = false;

function getDb(customPath) {
  if (!db || customPath) {
    if (customPath && db) {
      try {
        db.close();
      } catch (err) {
        console.warn('[DB] Error closing existing database:', err.message);
      }
      db = null;
      isInitialized = false;
    }

    const dbPath = customPath || config.DB_PATH;
    
    // Only create directory if using file-based default path
    if (!customPath && dbPath !== ':memory:') {
      if (!fs.existsSync(config.DATA_DIR)) {
        fs.mkdirSync(config.DATA_DIR, { recursive: true });
      }
    }
    
    db = new Database(dbPath, { timeout: config.DB_TIMEOUT_MS });
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL'); // Safe with WAL, improves performance
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${config.DB_TIMEOUT_MS}`);
    
    if (!isInitialized || customPath) {
      initSchema();
      if (!customPath) isInitialized = true;
    }
  }
  return db;
}

function resetDb() {
  if (db) {
    try {
      if (db.open) {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
      }
    } catch (err) {
      console.warn('[DB] Error during resetDb:', err.message);
    }
    db = null;
    isInitialized = false;
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
      units TEXT COLLATE NOCASE DEFAULT 'kg',
      decision_display_seconds INTEGER DEFAULT 15,
      short_code TEXT COLLATE NOCASE DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_meets_short_code ON meets(short_code) WHERE short_code != '';

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
      squat_rack_in_out TEXT DEFAULT 'OUT',
      bench_safety_height TEXT DEFAULT '4',
      bench_blocks TEXT DEFAULT 'N',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (meet_id) REFERENCES meets(id) ON DELETE CASCADE,
      FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL,
      FOREIGN KEY (weight_class_id) REFERENCES weight_classes(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lifters_meet_id ON lifters(meet_id);
    CREATE INDEX IF NOT EXISTS idx_lifters_platform_flight ON lifters(meet_id, platform, flight);

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
    CREATE INDEX IF NOT EXISTS idx_attempts_query ON attempts(lifter_id, lift_type, attempt_number);

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
      sql: "ALTER TABLE meets ADD COLUMN short_code TEXT COLLATE NOCASE DEFAULT ''; CREATE UNIQUE INDEX IF NOT EXISTS idx_meets_short_code ON meets(short_code) WHERE short_code != '';",
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
    {
      version: 6,
      description: 'Add units to meets',
      sql: "ALTER TABLE meets ADD COLUMN units TEXT DEFAULT 'kg'",
    },
    {
      version: 7,
      description: 'Add squat_rack_in_out to lifters',
      sql: "ALTER TABLE lifters ADD COLUMN squat_rack_in_out TEXT DEFAULT 'OUT'",
    },
  ];

  const migrationTx = db.transaction(() => {
    for (const m of migrations) {
      if (appliedVersions.has(m.version)) continue;
      try {
        db.exec(m.sql);
      } catch (e) {
        // 'duplicate column name' means it was already in base table or applied before version tracking
        if (!e.message.includes('duplicate column name')) {
          console.warn(`[DB] Migration v${m.version} warning: ${e.message}`);
          throw e;
        }
      }
      db.prepare('INSERT OR IGNORE INTO schema_versions (version) VALUES (?)').run(m.version);
    }
  });

  migrationTx();
}

function generateId() {
  return uuidv4();
}

module.exports = { getDb, generateId, resetDb };
