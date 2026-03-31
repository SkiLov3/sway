const express = require('express');
const { getDb, generateId } = require('../db');

const router = express.Router();

// Get attempts for a lifter
router.get('/lifter/:lifterId', (req, res) => {
  try {
    const db = getDb();
    const attempts = db.prepare('SELECT * FROM attempts WHERE lifter_id = ? ORDER BY lift_type, attempt_number').all(req.params.lifterId);
    res.json(attempts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update attempt (set weight, result, ref decisions)
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(req.params.id);
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    const { weight, result, ref1, ref2, ref3 } = req.body;
    
    if (weight !== undefined && weight !== null && (isNaN(weight) || weight < 0)) {
      return res.status(400).json({ error: 'Weight must be a positive number' });
    }

    db.prepare(`
      UPDATE attempts SET 
        weight = COALESCE(?, weight),
        result = COALESCE(?, result),
        ref1 = COALESCE(?, ref1),
        ref2 = COALESCE(?, ref2),
        ref3 = COALESCE(?, ref3)
      WHERE id = ?
    `).run(weight, result, ref1, ref2, ref3, req.params.id);

    const updated = db.prepare('SELECT * FROM attempts WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set attempt weight by lifter + lift type + number
router.put('/set/:lifterId/:liftType/:attemptNumber', (req, res) => {
  try {
    const db = getDb();
    const { lifterId, liftType, attemptNumber } = req.params;
    const { weight } = req.body;
    
    if (!weight || isNaN(weight) || weight <= 0) {
      return res.status(400).json({ error: 'Weight must be a positive number' });
    }
    
    const validLiftTypes = ['squat', 'bench', 'deadlift'];
    if (!validLiftTypes.includes(liftType)) {
      return res.status(400).json({ error: 'Invalid lift type' });
    }

    let attempt = db.prepare(
      'SELECT * FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = ?'
    ).get(lifterId, liftType, parseInt(attemptNumber));

    if (!attempt) {
      const id = generateId();
      db.prepare('INSERT INTO attempts (id, lifter_id, lift_type, attempt_number, weight) VALUES (?, ?, ?, ?, ?)').run(
        id, lifterId, liftType, parseInt(attemptNumber), weight
      );
      attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(id);
    } else {
      db.prepare('UPDATE attempts SET weight = ? WHERE id = ?').run(weight, attempt.id);
      attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attempt.id);
    }

    res.json(attempt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record referee decision
router.put('/decision/:lifterId/:liftType/:attemptNumber', (req, res) => {
  try {
    const db = getDb();
    const { lifterId, liftType, attemptNumber } = req.params;
    const { ref1, ref2, ref3 } = req.body;

    const processDecision = db.transaction(() => {
      const attempt = db.prepare(
        'SELECT * FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = ?'
      ).get(lifterId, liftType, parseInt(attemptNumber));

      if (!attempt) return { error: 'Attempt not found', status: 404 };

      // Validate ref decisions
      const validDecisions = ['', 'white', 'red'];
      if ((ref1 && !validDecisions.includes(ref1)) || (ref2 && !validDecisions.includes(ref2)) || (ref3 && !validDecisions.includes(ref3))) {
        return { error: 'Invalid referee decision. Must be "white" or "red"', status: 400 };
      }

      const r1 = ref1 ?? attempt.ref1;
      const r2 = ref2 ?? attempt.ref2;
      const r3 = ref3 ?? attempt.ref3;

      // Auto-determine result based on majority
      let result = attempt.result;
      const votes = [r1, r2, r3].filter(v => v !== '' && v !== null && v !== undefined);
      if (votes.length === 3) {
        const whites = votes.filter(v => v === 'white').length;
        result = whites >= 2 ? 'good' : 'no_good';
      }

      db.prepare(`
        UPDATE attempts SET ref1 = ?, ref2 = ?, ref3 = ?, result = ? WHERE id = ?
      `).run(r1, r2, r3, result, attempt.id);

      return { updated: db.prepare('SELECT * FROM attempts WHERE id = ?').get(attempt.id) };
    });

    const out = processDecision();
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.json(out.updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get lifting order for a flight
router.get('/order/:meetId/:platform/:flight/:liftType/:attemptNumber', (req, res) => {
  try {
    const db = getDb();
    const { meetId, platform, flight, liftType, attemptNumber } = req.params;

    const lifters = db.prepare(`
      SELECT l.*, d.name as division_name, wc.name as weight_class_name
      FROM lifters l
      LEFT JOIN divisions d ON l.division_id = d.id
      LEFT JOIN weight_classes wc ON l.weight_class_id = wc.id
      WHERE l.meet_id = ? AND l.platform = ? AND l.flight = ?
      ORDER BY l.lot_number
    `).all(meetId, parseInt(platform), flight);

    // Enrich with attempt data
    const enriched = lifters.map(lifter => {
      const attempts = db.prepare('SELECT * FROM attempts WHERE lifter_id = ? ORDER BY lift_type, attempt_number').all(lifter.id);
      const currentAttempt = attempts.find(a => a.lift_type === liftType && a.attempt_number === parseInt(attemptNumber));
      
      return {
        ...lifter,
        attempts,
        currentAttempt,
        currentWeight: currentAttempt?.weight || 0
      };
    });

    // Sort by: weight ascending, then lot number (standard powerlifting order)
    enriched.sort((a, b) => {
      if (a.currentWeight === 0 && b.currentWeight === 0) return (a.lot_number || 0) - (b.lot_number || 0);
      if (a.currentWeight === 0) return 1;
      if (b.currentWeight === 0) return -1;
      if (a.currentWeight !== b.currentWeight) return a.currentWeight - b.currentWeight;
      return (a.lot_number || 0) - (b.lot_number || 0);
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
