const express = require('express');
const { getDb, generateId } = require('../db');
const { calculateDOTS } = require('../utils/scoring');

const router = express.Router();

const MAX_MEET_NAME = 300;
const MAX_FED = 100;

// List all meets
router.get('/', (_req, res) => {
  try {
    const db = getDb();
    const meets = db.prepare('SELECT * FROM meets ORDER BY created_at DESC').all();
    res.json(meets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single meet
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const meet = db.prepare('SELECT * FROM meets WHERE id = ?').get(req.params.id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });
    res.json(meet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create meet (Atomic transaction)
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const id = generateId();
    const { name, date, federation, units } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Meet name is required' });
    }
    if (name.trim().length > MAX_MEET_NAME) {
      return res.status(400).json({ error: `Meet name must be ${MAX_MEET_NAME} characters or fewer` });
    }
    if (federation && federation.length > MAX_FED) {
      return res.status(400).json({ error: `Federation must be ${MAX_FED} characters or fewer` });
    }

    const resolvedUnits = (units || 'kg').toLowerCase() === 'lbs' ? 'lbs' : 'kg';
    const meetDate = date || new Date().toISOString().split('T')[0];

    const createTx = db.transaction(() => {
      db.prepare('INSERT INTO meets (id, name, date, federation, units) VALUES (?, ?, ?, ?, ?)').run(
        id, name.trim(), meetDate, federation || '', resolvedUnits
      );
      // Create default meet state
      db.prepare('INSERT INTO meet_state (meet_id) VALUES (?)').run(id);
    });

    createTx();
    
    const meet = db.prepare('SELECT * FROM meets WHERE id = ?').get(id);
    res.status(201).json(meet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update meet
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { name, date, federation, status, plates_config, short_code, units, decision_display_seconds } = req.body;
    const meet = db.prepare('SELECT * FROM meets WHERE id = ?').get(req.params.id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    // Validate name and federation lengths
    if (name !== undefined) {
      if (!name || name.trim().length === 0) return res.status(400).json({ error: 'Meet name cannot be empty' });
      if (name.trim().length > MAX_MEET_NAME) return res.status(400).json({ error: `Meet name must be ${MAX_MEET_NAME} characters or fewer` });
    }
    if (federation && federation.length > MAX_FED) return res.status(400).json({ error: `Federation must be ${MAX_FED} characters or fewer` });

    // Validate status
    if (status !== undefined) {
      const validStatuses = ['setup', 'running', 'complete'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Status must be "setup", "running", or "complete"' });
      }
    }

    // Validate short_code: alphanumeric only, max 12 chars, case-insensitive (NOCASE)
    let resolvedShortCode = meet.short_code ?? '';
    if (short_code !== undefined) {
      const code = short_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length > 12) return res.status(400).json({ error: 'Short code must be 12 characters or fewer' });
      // Check uniqueness if non-empty
      if (code !== '') {
        const existing = db.prepare('SELECT id, name FROM meets WHERE short_code = ? AND id != ?').get(code, req.params.id);
        if (existing) return res.status(409).json({ error: `Short code "${code}" is already in use by "${existing.name}"` });
      }
      resolvedShortCode = code;
    }

    // Validate decision_display_seconds
    let resolvedFlashSecs = meet.decision_display_seconds ?? 15;
    if (decision_display_seconds !== undefined) {
      const s = parseInt(decision_display_seconds, 10);
      if (isNaN(s) || s < 1 || s > 120) return res.status(400).json({ error: 'Decision display time must be between 1 and 120 seconds' });
      resolvedFlashSecs = s;
    }

    // Validate plates_config if provided
    let platesConfigStr = meet.plates_config;
    if (plates_config !== undefined) {
      try {
        const parsed = typeof plates_config === 'string' ? JSON.parse(plates_config) : plates_config;
        if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Must be an object');
        const serialized = JSON.stringify(parsed);
        if (serialized.length > 4096) throw new Error('plates_config too large');
        platesConfigStr = serialized;
      } catch (e) {
        return res.status(400).json({ error: `Invalid plates_config: ${e.message}` });
      }
    }

    const resolvedUnits = (units || meet.units || 'kg').toLowerCase() === 'lbs' ? 'lbs' : 'kg';

    db.prepare(`
      UPDATE meets SET name = ?, date = ?, federation = ?, status = ?, plates_config = ?,
        short_code = ?, decision_display_seconds = ?, units = ? WHERE id = ?
    `).run(
      name ?? meet.name,
      date ?? meet.date,
      federation ?? meet.federation,
      status ?? meet.status,
      platesConfigStr,
      resolvedShortCode,
      resolvedFlashSecs,
      resolvedUnits,
      req.params.id
    );

    // Broadcast meet update
    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ type: 'meet_updated', data: { meetId: req.params.id } });
    }

    res.json(db.prepare('SELECT * FROM meets WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete meet
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM meets WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Meet not found' });
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset meet strictly to openers (Non-destructive: preserves attempts 2 and 3 rows)
router.post('/:id/reset', (req, res) => {
  try {
    const db = getDb();
    const meet = db.prepare('SELECT id FROM meets WHERE id = ?').get(req.params.id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    const resetTx = db.transaction(() => {
      // 1. Reset attempt 1 back to unjudged state
      db.prepare(`
        UPDATE attempts 
        SET result = 'pending', ref1 = '', ref2 = '', ref3 = ''
        WHERE lifter_id IN (SELECT id FROM lifters WHERE meet_id = ?) AND attempt_number = 1
      `).run(req.params.id);

      // 2. Clear attempt 2, 3, 4 without deleting rows (so future judging works)
      db.prepare(`
        UPDATE attempts 
        SET weight = NULL, result = 'pending', ref1 = '', ref2 = '', ref3 = ''
        WHERE lifter_id IN (SELECT id FROM lifters WHERE meet_id = ?) AND attempt_number > 1
      `).run(req.params.id);

      // 3. Fully reset meet state (even if no lifters are registered yet)
      db.prepare(`
        UPDATE meet_state 
        SET current_platform = 1, current_lift_type = 'squat', current_flight = 'A', current_attempt_number = 1,
            current_lifter_id = '', clock_seconds = 60, clock_running = 0, round_number = 1
        WHERE meet_id = ?
      `).run(req.params.id);

      // 4. Reset meet status back to setup
      db.prepare("UPDATE meets SET status = 'setup' WHERE id = ?").run(req.params.id);
    });

    resetTx();

    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ type: 'meet_updated', data: { meetId: req.params.id } });
      broadcast({ type: 'state_changed', data: { meetId: req.params.id } });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Divisions ---

router.get('/:id/divisions', (req, res) => {
  try {
    const db = getDb();
    const meet = db.prepare('SELECT id FROM meets WHERE id = ?').get(req.params.id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    const divisions = db.prepare(`
      SELECT d.*, 
        (SELECT json_group_array(json_object('id', wc.id, 'name', wc.name, 'maxWeight', wc.max_weight, 'sortOrder', wc.sort_order))
         FROM weight_classes wc WHERE wc.division_id = d.id ORDER BY wc.sort_order) as weight_classes
      FROM divisions d WHERE d.meet_id = ? ORDER BY d.sort_order
    `).all(req.params.id);
    
    divisions.forEach(d => {
      d.weight_classes = JSON.parse(d.weight_classes || '[]');
    });
    
    res.json(divisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/divisions', (req, res) => {
  try {
    const db = getDb();
    const meet = db.prepare('SELECT id FROM meets WHERE id = ?').get(req.params.id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    const id = generateId();
    const { name, sort_order } = req.body;
    
    db.prepare('INSERT INTO divisions (id, meet_id, name, sort_order) VALUES (?, ?, ?, ?)').run(
      id, req.params.id, name || 'New Division', sort_order || 0
    );
    
    res.status(201).json(db.prepare('SELECT * FROM divisions WHERE id = ?').get(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/divisions/:divId', (req, res) => {
  try {
    const db = getDb();
    const { name, sort_order } = req.body;
    const existing = db.prepare('SELECT * FROM divisions WHERE id = ?').get(req.params.divId);
    if (!existing) return res.status(404).json({ error: 'Division not found' });

    db.prepare('UPDATE divisions SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ?').run(
      name, sort_order, req.params.divId
    );
    res.json(db.prepare('SELECT * FROM divisions WHERE id = ?').get(req.params.divId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/divisions/:divId', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM divisions WHERE id = ?').run(req.params.divId);
    if (result.changes === 0) return res.status(404).json({ error: 'Division not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Weight Classes ---

router.post('/divisions/:divId/weight-classes', (req, res) => {
  try {
    const db = getDb();
    const division = db.prepare('SELECT id FROM divisions WHERE id = ?').get(req.params.divId);
    if (!division) return res.status(404).json({ error: 'Division not found' });

    const id = generateId();
    const { name, max_weight, sort_order } = req.body;
    
    db.prepare('INSERT INTO weight_classes (id, division_id, name, max_weight, sort_order) VALUES (?, ?, ?, ?, ?)').run(
      id, req.params.divId, name || '', max_weight || null, sort_order || 0
    );
    
    res.status(201).json(db.prepare('SELECT * FROM weight_classes WHERE id = ?').get(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/weight-classes/:wcId', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM weight_classes WHERE id = ?').get(req.params.wcId);
    if (!existing) return res.status(404).json({ error: 'Weight class not found' });

    const { name, max_weight, sort_order } = req.body;
    db.prepare('UPDATE weight_classes SET name = COALESCE(?, name), max_weight = COALESCE(?, max_weight), sort_order = COALESCE(?, sort_order) WHERE id = ?').run(
      name, max_weight, sort_order, req.params.wcId
    );
    res.json(db.prepare('SELECT * FROM weight_classes WHERE id = ?').get(req.params.wcId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/weight-classes/:wcId', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM weight_classes WHERE id = ?').run(req.params.wcId);
    if (result.changes === 0) return res.status(404).json({ error: 'Weight class not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Meet State ---

router.get('/:id/state', (req, res) => {
  try {
    const db = getDb();
    const meet = db.prepare('SELECT id FROM meets WHERE id = ?').get(req.params.id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    db.prepare('INSERT OR IGNORE INTO meet_state (meet_id) VALUES (?)').run(req.params.id);
    const state = db.prepare('SELECT * FROM meet_state WHERE meet_id = ?').get(req.params.id);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/state', (req, res) => {
  try {
    const db = getDb();
    const { 
      current_platform, current_lift_type, current_attempt_number, 
      current_flight, current_lifter_id, clock_seconds, clock_running, round_number 
    } = req.body;
    
    const meet = db.prepare('SELECT id FROM meets WHERE id = ?').get(req.params.id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    if (current_lift_type !== undefined && !['squat', 'bench', 'deadlift'].includes(current_lift_type)) {
      return res.status(400).json({ error: 'Invalid lift type' });
    }
    if (current_attempt_number !== undefined && (current_attempt_number < 1 || current_attempt_number > 4)) {
      return res.status(400).json({ error: 'Attempt number must be between 1 and 4' });
    }

    db.prepare('INSERT OR IGNORE INTO meet_state (meet_id) VALUES (?)').run(req.params.id);
    const existing = db.prepare('SELECT * FROM meet_state WHERE meet_id = ?').get(req.params.id);
    
    // Allow explicitly setting current_lifter_id to '' or null to clear it
    const resolvedLifterId = current_lifter_id !== undefined ? (current_lifter_id || '') : existing.current_lifter_id;

    db.prepare(`
      UPDATE meet_state SET 
        current_platform = ?,
        current_lift_type = ?,
        current_attempt_number = ?,
        current_flight = ?,
        current_lifter_id = ?,
        clock_seconds = ?,
        clock_running = ?,
        round_number = ?
      WHERE meet_id = ?
    `).run(
      current_platform !== undefined ? current_platform : existing.current_platform,
      current_lift_type !== undefined ? current_lift_type : existing.current_lift_type,
      current_attempt_number !== undefined ? current_attempt_number : existing.current_attempt_number,
      current_flight !== undefined ? current_flight : existing.current_flight,
      resolvedLifterId,
      clock_seconds !== undefined ? clock_seconds : existing.clock_seconds,
      clock_running !== undefined ? clock_running : existing.clock_running,
      round_number !== undefined ? round_number : existing.round_number,
      req.params.id
    );
    
    const updated = db.prepare('SELECT * FROM meet_state WHERE meet_id = ?').get(req.params.id);

    // Broadcast state change
    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ 
        type: 'state_changed', 
        data: { 
          meetId: req.params.id, 
          ...updated
        } 
      });
    }
    
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Results (Powerlifting Rules Compliant) ---

router.get('/:id/results', (req, res) => {
  try {
    const db = getDb();
    const isForecasted = req.query.forecasted === 'true';
    
    const meet = db.prepare('SELECT * FROM meets WHERE id = ?').get(req.params.id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    const lifters = db.prepare(`
      SELECT l.*, d.name as division_name, wc.name as weight_class_name
      FROM lifters l
      LEFT JOIN divisions d ON l.division_id = d.id
      LEFT JOIN weight_classes wc ON l.weight_class_id = wc.id
      WHERE l.meet_id = ?
      ORDER BY d.sort_order, d.name, wc.sort_order, wc.name, l.name
    `).all(req.params.id);

    const attempts = db.prepare(`
      SELECT a.* FROM attempts a
      JOIN lifters l ON a.lifter_id = l.id
      WHERE l.meet_id = ?
    `).all(req.params.id);

    // Group attempts by lifter
    const attemptsByLifter = {};
    attempts.forEach(a => {
      if (!attemptsByLifter[a.lifter_id]) attemptsByLifter[a.lifter_id] = [];
      attemptsByLifter[a.lifter_id].push(a);
    });

    // Calculate totals, best lifts, and rule disqualifications
    const results = lifters.map(lifter => {
      const la = attemptsByLifter[lifter.id] || [];

      // 4th attempts are record-only and strictly EXCLUDED from best lifts and total
      const getBest = (type) => {
        const candidates = la.filter(a => {
          if (a.lift_type !== type || a.attempt_number > 3) return false;
          if (a.result === 'good') return true;
          // In forecasted mode, treat 'pending' as good (Best Case Scenario)
          if (isForecasted && a.result === 'pending' && a.weight > 0) return true;
          return false;
        });
        return candidates.length > 0 ? Math.max(...candidates.map(a => a.weight)) : 0;
      };
      
      const bestSquat = getBest('squat');
      const bestBench = getBest('bench');
      const bestDeadlift = getBest('deadlift');

      // Check event specialization by division name
      const divNameLower = String(lifter.division_name || '').toLowerCase();
      const isBenchOnly = divNameLower.includes('bench only');
      const isDeadliftOnly = divNameLower.includes('deadlift only') || divNameLower.includes('dead only');
      const isPushPull = divNameLower.includes('push/pull') || divNameLower.includes('push pull');
      const isSquatOnly = divNameLower.includes('squat only');

      // Check bomb-outs: if all attempts in an active event are finished and none are good
      const squatAttempts = la.filter(a => a.lift_type === 'squat' && a.attempt_number <= 3);
      const benchAttempts = la.filter(a => a.lift_type === 'bench' && a.attempt_number <= 3);
      const deadliftAttempts = la.filter(a => a.lift_type === 'deadlift' && a.attempt_number <= 3);

      const squatFinished = squatAttempts.length > 0 && squatAttempts.every(a => a.result !== 'pending');
      const benchFinished = benchAttempts.length > 0 && benchAttempts.every(a => a.result !== 'pending');
      const deadliftFinished = deadliftAttempts.length > 0 && deadliftAttempts.every(a => a.result !== 'pending');

      let bombedOut = false;
      if (isBenchOnly) {
        bombedOut = benchFinished && bestBench === 0;
      } else if (isDeadliftOnly) {
        bombedOut = deadliftFinished && bestDeadlift === 0;
      } else if (isPushPull) {
        bombedOut = (benchFinished && bestBench === 0) || (deadliftFinished && bestDeadlift === 0);
      } else if (isSquatOnly) {
        bombedOut = squatFinished && bestSquat === 0;
      } else {
        // Full Power: failing all attempts in ANY required lift constitutes a bomb-out
        bombedOut = (squatFinished && bestSquat === 0) ||
                    (benchFinished && bestBench === 0) ||
                    (deadliftFinished && bestDeadlift === 0);
      }

      // In final complete meet, full powerlifters must have all three disciplines
      const isMeetComplete = meet.status === 'complete';
      let total = 0;
      if (!bombedOut) {
        if (isBenchOnly) {
          total = bestBench;
        } else if (isDeadliftOnly) {
          total = bestDeadlift;
        } else if (isPushPull) {
          total = bestBench + bestDeadlift;
        } else if (isSquatOnly) {
          total = bestSquat;
        } else {
          // Full Power
          if (isMeetComplete) {
            if (bestSquat > 0 && bestBench > 0 && bestDeadlift > 0) {
              total = bestSquat + bestBench + bestDeadlift;
            }
          } else {
            total = bestSquat + bestBench + bestDeadlift;
          }
        }
      }
        
      const dots = total > 0 ? calculateDOTS(total, lifter.body_weight, lifter.gender, meet.units || 'kg') : 0;

      return {
        ...lifter,
        attempts: la,
        bestSquat,
        bestBench,
        bestDeadlift,
        total,
        dots,
        bombedOut,
        isForecasted
      };
    });

    // Group by division + weight class and compute placings
    const groups = {};
    results.forEach(r => {
      const key = `${r.division_name || 'Unassigned'}|||${r.weight_class_name || 'Unassigned'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    // Sort by: 1) Total desc, 2) Lighter bodyweight wins, 3) Lower lot number tie-breaker
    Object.values(groups).forEach(group => {
      group.sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        const bwA = a.body_weight ?? 9999;
        const bwB = b.body_weight ?? 9999;
        if (bwA !== bwB) return bwA - bwB;
        return (a.lot_number ?? 9999) - (b.lot_number ?? 9999);
      });

      let currentPlace = 1;
      group.forEach((lifter, idx) => {
        if (lifter.total <= 0 || lifter.bombedOut) {
          lifter.place = '-';
          return;
        }
        if (idx > 0) {
          const prev = group[idx - 1];
          if (lifter.total !== prev.total || lifter.body_weight !== prev.body_weight) {
            currentPlace = idx + 1;
          }
        }
        lifter.place = currentPlace;
      });
    });

    // Calculate Best Lifters cleanly partitioned by gender
    const bestMale = results.filter(r => r.dots > 0 && r.gender === 'M').sort((a, b) => b.dots - a.dots).slice(0, 10);
    const bestFemale = results.filter(r => r.dots > 0 && r.gender === 'F').sort((a, b) => b.dots - a.dots).slice(0, 10);
    const bestMx = results.filter(r => r.dots > 0 && r.gender === 'X').sort((a, b) => b.dots - a.dots).slice(0, 10);

    // Team Scoring: places 1..10 award 12, 9, 8, 7, 6, 5, 4, 3, 2, 1 points
    const teamPointsMap = { 1: 12, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };
    const teamScores = {};

    Object.values(groups).forEach(group => {
      group.forEach(lifter => {
        if (lifter.team && lifter.team.trim() && typeof lifter.place === 'number' && teamPointsMap[lifter.place]) {
          const teamName = lifter.team.trim();
          teamScores[teamName] = (teamScores[teamName] || 0) + teamPointsMap[lifter.place];
        }
      });
    });

    const teamStandings = Object.entries(teamScores)
      .map(([team, points]) => ({ team, points }))
      .sort((a, b) => b.points - a.points);

    res.json({ results, groups, bestMale, bestFemale, bestMx, teamStandings });
  } catch (err) {
    console.error('[API] Error generating results:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
