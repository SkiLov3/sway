const express = require('express');
const { getDb, generateId } = require('../db');
const { calculateDOTS } = require('../utils/scoring');

const router = express.Router();

// List all meets
router.get('/', (req, res) => {
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

// Create meet
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const id = generateId();
    const { name, date, federation } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Meet name is required' });
    }
    
    db.prepare('INSERT INTO meets (id, name, date, federation) VALUES (?, ?, ?, ?)').run(
      id, name.trim(), date || new Date().toISOString().split('T')[0], federation || ''
    );
    
    // Create default meet state
    db.prepare('INSERT INTO meet_state (meet_id) VALUES (?)').run(id);
    
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
    const { name, date, federation, status, plates_config } = req.body;
    const meet = db.prepare('SELECT * FROM meets WHERE id = ?').get(req.params.id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    db.prepare(`
      UPDATE meets SET name = ?, date = ?, federation = ?, status = ?, plates_config = ? WHERE id = ?
    `).run(
      name ?? meet.name,
      date ?? meet.date,
      federation ?? meet.federation,
      status ?? meet.status,
      plates_config ?? meet.plates_config,
      req.params.id
    );

    res.json(db.prepare('SELECT * FROM meets WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete meet
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM meets WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Divisions ---

router.get('/:id/divisions', (req, res) => {
  const db = getDb();
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
});

router.post('/:id/divisions', (req, res) => {
  const db = getDb();
  const id = generateId();
  const { name, sort_order } = req.body;
  
  db.prepare('INSERT INTO divisions (id, meet_id, name, sort_order) VALUES (?, ?, ?, ?)').run(
    id, req.params.id, name || 'New Division', sort_order || 0
  );
  
  res.status(201).json(db.prepare('SELECT * FROM divisions WHERE id = ?').get(id));
});

router.put('/divisions/:divId', (req, res) => {
  const db = getDb();
  const { name, sort_order } = req.body;
  db.prepare('UPDATE divisions SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ?').run(
    name, sort_order, req.params.divId
  );
  res.json(db.prepare('SELECT * FROM divisions WHERE id = ?').get(req.params.divId));
});

router.delete('/divisions/:divId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM divisions WHERE id = ?').run(req.params.divId);
  res.json({ success: true });
});

// --- Weight Classes ---

router.post('/divisions/:divId/weight-classes', (req, res) => {
  const db = getDb();
  const id = generateId();
  const { name, max_weight, sort_order } = req.body;
  
  db.prepare('INSERT INTO weight_classes (id, division_id, name, max_weight, sort_order) VALUES (?, ?, ?, ?, ?)').run(
    id, req.params.divId, name || '', max_weight || null, sort_order || 0
  );
  
  res.status(201).json(db.prepare('SELECT * FROM weight_classes WHERE id = ?').get(id));
});

router.put('/weight-classes/:wcId', (req, res) => {
  const db = getDb();
  const { name, max_weight, sort_order } = req.body;
  db.prepare('UPDATE weight_classes SET name = COALESCE(?, name), max_weight = COALESCE(?, max_weight), sort_order = COALESCE(?, sort_order) WHERE id = ?').run(
    name, max_weight, sort_order, req.params.wcId
  );
  res.json(db.prepare('SELECT * FROM weight_classes WHERE id = ?').get(req.params.wcId));
});

router.delete('/weight-classes/:wcId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM weight_classes WHERE id = ?').run(req.params.wcId);
  res.json({ success: true });
});

// --- Meet State ---

router.get('/:id/state', (req, res) => {
  const db = getDb();
  let state = db.prepare('SELECT * FROM meet_state WHERE meet_id = ?').get(req.params.id);
  if (!state) {
    db.prepare('INSERT INTO meet_state (meet_id) VALUES (?)').run(req.params.id);
    state = db.prepare('SELECT * FROM meet_state WHERE meet_id = ?').get(req.params.id);
  }
  res.json(state);
});

router.put('/:id/state', (req, res) => {
  const db = getDb();
  const { current_platform, current_lift_type, current_attempt_number, current_flight, current_lifter_id, clock_seconds, clock_running } = req.body;
  
  let state = db.prepare('SELECT * FROM meet_state WHERE meet_id = ?').get(req.params.id);
  if (!state) {
    db.prepare('INSERT INTO meet_state (meet_id) VALUES (?)').run(req.params.id);
    state = db.prepare('SELECT * FROM meet_state WHERE meet_id = ?').get(req.params.id);
  }
  
  db.prepare(`
    UPDATE meet_state SET 
      current_platform = COALESCE(?, current_platform),
      current_lift_type = COALESCE(?, current_lift_type),
      current_attempt_number = COALESCE(?, current_attempt_number),
      current_flight = COALESCE(?, current_flight),
      current_lifter_id = COALESCE(?, current_lifter_id),
      clock_seconds = COALESCE(?, clock_seconds),
      clock_running = COALESCE(?, clock_running)
    WHERE meet_id = ?
  `).run(
    current_platform, current_lift_type, current_attempt_number, current_flight,
    current_lifter_id, clock_seconds, clock_running, req.params.id
  );
  
  res.json(db.prepare('SELECT * FROM meet_state WHERE meet_id = ?').get(req.params.id));
});

// --- Results ---

router.get('/:id/results', (req, res) => {
  const db = getDb();
  
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

  // Calculate totals and best lifts
  const results = lifters.map(lifter => {
    const la = attemptsByLifter[lifter.id] || [];
    const getBest = (type) => {
      const good = la.filter(a => a.lift_type === type && a.result === 'good');
      return good.length > 0 ? Math.max(...good.map(a => a.weight)) : 0;
    };
    
    const bestSquat = getBest('squat');
    const bestBench = getBest('bench');
    const bestDeadlift = getBest('deadlift');
    const total = (bestSquat > 0 && bestBench > 0 && bestDeadlift > 0) 
      ? bestSquat + bestBench + bestDeadlift : 0;
      
    const dots = calculateDOTS(total, lifter.body_weight, lifter.gender);

    return {
      ...lifter,
      attempts: la,
      bestSquat,
      bestBench,
      bestDeadlift,
      total,
      dots
    };
  });

  // Group by division + weight class and compute placings
  const groups = {};
  results.forEach(r => {
    const key = `${r.division_name || 'Unassigned'}|||${r.weight_class_name || 'Unassigned'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  // Sort by total desc within each group, assign places
  Object.values(groups).forEach(group => {
    group.sort((a, b) => {
      // Primary: Total desc
      if (b.total !== a.total) return b.total - a.total;
      // Secondary: Lighter body weight wins
      return (a.body_weight || 9999) - (b.body_weight || 9999);
    });
    group.forEach((lifter, idx) => {
      lifter.place = lifter.total > 0 ? idx + 1 : '-';
    });
  });

  // Calculate Best Lifters across the entire meet (sorted by DOTS)
  const bestLifters = results.filter(r => r.total > 0).sort((a, b) => b.dots - a.dots);

  res.json({ results, groups, bestLifters });
});

module.exports = router;
