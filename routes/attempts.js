const express = require('express');
const router = express.Router();
const { getDb, generateId } = require('../db');

// Helper to broadcast attempt changes
function broadcastAttempt(req, type, meetId, attempt) {
  const broadcast = req.app.get('broadcast');
  if (!broadcast) return;

  const votes = [attempt.ref1, attempt.ref2, attempt.ref3].filter(v => v === 'white' || v === 'red');
  const isFinalDecision = votes.length === 3;

  // Mask individual light colors on public broadcast until all 3 referees have voted (IPF / USAPL rule)
  const payload = {
    type,
    data: {
      meetId,
      lifterId: attempt.lifter_id,
      id: attempt.id,
      liftType: attempt.lift_type,
      attemptNumber: attempt.attempt_number,
      weight: attempt.weight,
      result: attempt.result,
      ref1: isFinalDecision ? attempt.ref1 : (attempt.ref1 ? 'voted' : ''),
      ref2: isFinalDecision ? attempt.ref2 : (attempt.ref2 ? 'voted' : ''),
      ref3: isFinalDecision ? attempt.ref3 : (attempt.ref3 ? 'voted' : ''),
      ref1Voted: Boolean(attempt.ref1),
      ref2Voted: Boolean(attempt.ref2),
      ref3Voted: Boolean(attempt.ref3)
    }
  };
  broadcast(payload);
}

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
    
    if (weight !== undefined && weight !== null && weight !== '') {
      const numWeight = Number(weight);
      if (!Number.isFinite(numWeight) || numWeight <= 0) {
        return res.status(400).json({ error: 'Weight must be a positive number' });
      }
    }

    const validResults = ['good', 'no_good', 'pending', 'skipped'];
    if (result !== undefined && !validResults.includes(result)) {
      return res.status(400).json({ error: 'Invalid result value' });
    }

    const validRefs = ['', 'white', 'red'];
    if (ref1 !== undefined && !validRefs.includes(ref1)) return res.status(400).json({ error: 'Invalid ref1' });
    if (ref2 !== undefined && !validRefs.includes(ref2)) return res.status(400).json({ error: 'Invalid ref2' });
    if (ref3 !== undefined && !validRefs.includes(ref3)) return res.status(400).json({ error: 'Invalid ref3' });

    db.prepare(`
      UPDATE attempts SET 
        weight = COALESCE(?, weight),
        result = COALESCE(?, result),
        ref1 = COALESCE(?, ref1),
        ref2 = COALESCE(?, ref2),
        ref3 = COALESCE(?, ref3)
      WHERE id = ?
    `).run(weight !== undefined ? weight : null, result, ref1, ref2, ref3, req.params.id);

    const updated = db.prepare('SELECT * FROM attempts WHERE id = ?').get(req.params.id);
    const lifter = db.prepare('SELECT meet_id FROM lifters WHERE id = ?').get(updated.lifter_id);
    broadcastAttempt(req, 'attempt_updated', lifter?.meet_id, updated);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set attempt weight by lifter + lift type + number (with progression rules & atomic upsert)
router.put('/set/:lifterId/:liftType/:attemptNumber', (req, res) => {
  try {
    const db = getDb();
    const { lifterId, liftType, attemptNumber } = req.params;
    const { weight } = req.body;

    const parsedAttemptNumber = parseInt(attemptNumber, 10);
    if (isNaN(parsedAttemptNumber) || parsedAttemptNumber < 1 || parsedAttemptNumber > 4) {
      return res.status(400).json({ error: 'Attempt number must be between 1 and 4' });
    }

    const validLiftTypes = ['squat', 'bench', 'deadlift'];
    if (!validLiftTypes.includes(liftType)) {
      return res.status(400).json({ error: 'Invalid lift type' });
    }

    const lifter = db.prepare('SELECT meet_id FROM lifters WHERE id = ?').get(lifterId);
    if (!lifter) {
      return res.status(404).json({ error: 'Lifter not found' });
    }
    
    let parsedWeight = null;
    if (weight !== undefined && weight !== null && String(weight).trim() !== '') {
      parsedWeight = parseFloat(weight);
      if (isNaN(parsedWeight) || parsedWeight <= 0) {
        return res.status(400).json({ error: 'Weight must be a positive number' });
      }

      // Check progression: attempt weight cannot be less than previous attempt weight
      if (parsedAttemptNumber > 1) {
        const prevAttempt = db.prepare(
          'SELECT weight FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = ?'
        ).get(lifterId, liftType, parsedAttemptNumber - 1);

        if (prevAttempt && prevAttempt.weight !== null && prevAttempt.weight > 0 && parsedWeight < prevAttempt.weight) {
          return res.status(400).json({ 
            error: `Attempt ${parsedAttemptNumber} weight (${parsedWeight}) cannot be less than Attempt ${parsedAttemptNumber - 1} weight (${prevAttempt.weight})` 
          });
        }
      }
    }

    // Atomic Upsert
    const setAttemptTx = db.transaction(() => {
      let existing = db.prepare(
        'SELECT * FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = ?'
      ).get(lifterId, liftType, parsedAttemptNumber);

      if (!existing) {
        if (parsedWeight === null) return null;
        const newId = generateId();
        db.prepare(`
          INSERT INTO attempts (id, lifter_id, lift_type, attempt_number, weight)
          VALUES (?, ?, ?, ?, ?)
        `).run(newId, lifterId, liftType, parsedAttemptNumber, parsedWeight);
      } else {
        if (parsedWeight === null) {
          db.prepare(`
            UPDATE attempts 
            SET weight = NULL, result = 'pending', ref1 = '', ref2 = '', ref3 = '' 
            WHERE id = ?
          `).run(existing.id);
        } else {
          db.prepare('UPDATE attempts SET weight = ? WHERE id = ?').run(parsedWeight, existing.id);
        }
      }

      return db.prepare(
        'SELECT * FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = ?'
      ).get(lifterId, liftType, parsedAttemptNumber);
    });

    const attempt = setAttemptTx();
    if (!attempt) return res.json({});

    broadcastAttempt(req, 'attempt_updated', lifter.meet_id, attempt);
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

    const parsedAttemptNumber = parseInt(attemptNumber, 10);
    if (isNaN(parsedAttemptNumber) || parsedAttemptNumber < 1 || parsedAttemptNumber > 4) {
      return res.status(400).json({ error: 'Attempt number must be between 1 and 4' });
    }

    const processDecision = db.transaction(() => {
      const attempt = db.prepare(
        'SELECT * FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = ?'
      ).get(lifterId, liftType, parsedAttemptNumber);

      if (!attempt) return { error: 'Attempt not found', status: 404 };

      // Validate ref decisions
      const validDecisions = ['', 'white', 'red'];
      if ((ref1 !== undefined && !validDecisions.includes(ref1)) ||
          (ref2 !== undefined && !validDecisions.includes(ref2)) ||
          (ref3 !== undefined && !validDecisions.includes(ref3))) {
        return { error: 'Invalid referee decision. Must be "white" or "red"', status: 400 };
      }

      const r1 = ref1 !== undefined ? ref1 : attempt.ref1;
      const r2 = ref2 !== undefined ? ref2 : attempt.ref2;
      const r3 = ref3 !== undefined ? ref3 : attempt.ref3;

      // Auto-determine result based on majority of 3 votes
      let result = attempt.result;
      const votes = [r1, r2, r3].filter(v => v === 'white' || v === 'red');
      if (votes.length === 3) {
        const whites = votes.filter(v => v === 'white').length;
        result = whites >= 2 ? 'good' : 'no_good';
      } else {
        result = 'pending';
      }

      db.prepare(`
        UPDATE attempts SET ref1 = ?, ref2 = ?, ref3 = ?, result = ? WHERE id = ?
      `).run(r1, r2, r3, result, attempt.id);

      return { updated: db.prepare('SELECT * FROM attempts WHERE id = ?').get(attempt.id) };
    });

    const out = processDecision();
    if (out.error) return res.status(out.status).json({ error: out.error });
    
    if (out.updated) {
      const lifter = db.prepare('SELECT meet_id FROM lifters WHERE id = ?').get(out.updated.lifter_id);
      broadcastAttempt(req, 'decision_made', lifter?.meet_id, out.updated);
    }

    res.json(out.updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get lifting order for a flight (Optimized: single batch query for attempts)
router.get('/order/:meetId/:platform/:flight/:liftType/:attemptNumber', (req, res) => {
  try {
    const db = getDb();
    const { meetId, platform, flight, liftType, attemptNumber } = req.params;
    const parsedAttemptNumber = parseInt(attemptNumber, 10);
    const parsedPlatform = parseInt(platform, 10);

    const lifters = db.prepare(`
      SELECT l.*, d.name as division_name, wc.name as weight_class_name
      FROM lifters l
      LEFT JOIN divisions d ON l.division_id = d.id
      LEFT JOIN weight_classes wc ON l.weight_class_id = wc.id
      WHERE l.meet_id = ? AND l.platform = ? AND l.flight = ?
      ORDER BY l.lot_number
    `).all(meetId, parsedPlatform, flight);

    if (lifters.length === 0) {
      return res.json([]);
    }

    // Batch fetch all attempts for all lifters in this flight (eliminating N+1 query)
    const allAttempts = db.prepare(`
      SELECT a.* FROM attempts a
      JOIN lifters l ON a.lifter_id = l.id
      WHERE l.meet_id = ? AND l.platform = ? AND l.flight = ?
      ORDER BY a.lift_type, a.attempt_number
    `).all(meetId, parsedPlatform, flight);

    const attemptsByLifter = {};
    for (const a of allAttempts) {
      if (!attemptsByLifter[a.lifter_id]) attemptsByLifter[a.lifter_id] = [];
      attemptsByLifter[a.lifter_id].push(a);
    }

    // Enrich with attempt data
    const enriched = lifters.map(lifter => {
      const attempts = attemptsByLifter[lifter.id] || [];
      const currentAttempt = attempts.find(a => a.lift_type === liftType && a.attempt_number === parsedAttemptNumber);
      
      return {
        ...lifter,
        attempts,
        currentAttempt,
        currentWeight: currentAttempt?.weight || 0
      };
    });

    // Sort by: weight ascending, then lot number (standard powerlifting order)
    enriched.sort((a, b) => {
      const wA = parseFloat(a.currentWeight) || 0;
      const wB = parseFloat(b.currentWeight) || 0;
      const lotA = parseInt(a.lot_number, 10) || 0;
      const lotB = parseInt(b.lot_number, 10) || 0;

      if (wA === 0 && wB === 0) return lotA - lotB;
      if (wA === 0) return 1;
      if (wB === 0) return -1;
      if (wA !== wB) return wA - wB;
      return lotA - lotB;
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
