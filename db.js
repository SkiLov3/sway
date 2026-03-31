const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data', 'sway.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
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
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (meet_id) REFERENCES meets(id) ON DELETE CASCADE,
      FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL,
      FOREIGN KEY (weight_class_id) REFERENCES weight_classes(id) ON DELETE SET NULL
    );

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

  // Simple migration strategy for existing DBs
  try {
    db.exec("ALTER TABLE lifters ADD COLUMN gender TEXT DEFAULT 'M' CHECK(gender IN ('M', 'F', 'X'))");
  } catch (e) {
    // Column likely already exists
  }
}

function generateId() {
  return uuidv4();
}

module.exports = { getDb, generateId };
