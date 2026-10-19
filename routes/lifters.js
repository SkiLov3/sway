const express = require('express');
const { getDb, generateId } = require('../db');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const config = require('../config');

const router = express.Router();

// Configure multer for CSV uploads — Memory storage (no orphan disk files), 2 MB max
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'text/csv'
      || file.mimetype === 'application/vnd.ms-excel'
      || file.originalname.toLowerCase().endsWith('.csv');
    if (!ok) return cb(new Error('Only CSV files are accepted'), false);
    cb(null, true);
  },
});

// Helper constants
const MAX_NAME = 200;
const MAX_TEAM = 200;
const MAX_RACK = 20;

// List lifters for a meet
router.get('/meet/:meetId', (req, res) => {
  try {
    const db = getDb();
    const lifters = db.prepare(`
      SELECT l.*, d.name as division_name, wc.name as weight_class_name
      FROM lifters l
      LEFT JOIN divisions d ON l.division_id = d.id
      LEFT JOIN weight_classes wc ON l.weight_class_id = wc.id
      WHERE l.meet_id = ?
      ORDER BY l.flight, l.lot_number, l.name
    `).all(req.params.meetId);
    res.json(lifters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single lifter with attempts
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const lifter = db.prepare(`
      SELECT l.*, d.name as division_name, wc.name as weight_class_name
      FROM lifters l
      LEFT JOIN divisions d ON l.division_id = d.id
      LEFT JOIN weight_classes wc ON l.weight_class_id = wc.id
      WHERE l.id = ?
    `).get(req.params.id);
    
    if (!lifter) return res.status(404).json({ error: 'Lifter not found' });
    
    lifter.attempts = db.prepare('SELECT * FROM attempts WHERE lifter_id = ? ORDER BY lift_type, attempt_number').all(req.params.id);
    res.json(lifter);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create lifter
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const id = generateId();
    const { 
      meet_id, name, team, division_id, weight_class_id, gender, body_weight, 
      lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height,
      squat_rack_in_out, bench_safety_height, bench_blocks
    } = req.body;
    
    if (!meet_id) return res.status(400).json({ error: 'meet_id is required' });
    const meet = db.prepare('SELECT id FROM meets WHERE id = ?').get(meet_id);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    if (!name || name.trim().length === 0) return res.status(400).json({ error: 'Lifter name is required' });
    if (name.trim().length > MAX_NAME) return res.status(400).json({ error: `Name must be ${MAX_NAME} characters or fewer` });
    if (team && team.length > MAX_TEAM) return res.status(400).json({ error: `Team must be ${MAX_TEAM} characters or fewer` });
    
    if (body_weight !== undefined && body_weight !== null && body_weight !== '') {
      const bw = parseFloat(body_weight);
      if (isNaN(bw) || bw <= 0) return res.status(400).json({ error: 'Body weight must be a positive number' });
    }

    let parsedGender = (gender || 'M').toString().trim().toUpperCase();
    if (!['M', 'F', 'X'].includes(parsedGender)) parsedGender = 'M';

    // Validate foreign keys belong to the correct meet
    if (division_id) {
      const div = db.prepare('SELECT id FROM divisions WHERE id = ? AND meet_id = ?').get(division_id, meet_id);
      if (!div) return res.status(400).json({ error: 'Invalid division_id for this meet' });
    }
    if (weight_class_id && division_id) {
      const wc = db.prepare('SELECT id FROM weight_classes WHERE id = ? AND division_id = ?').get(weight_class_id, division_id);
      if (!wc) return res.status(400).json({ error: 'Invalid weight_class_id for this division' });
    }

    const safeRackHeight = String(rack_height || '').substring(0, MAX_RACK);
    const safeSquatRack = String(squat_rack_height || '').substring(0, MAX_RACK);
    const safeBenchRack = String(bench_rack_height || '').substring(0, MAX_RACK);
    const safeSquatInOut = ['IN', 'OUT'].includes(String(squat_rack_in_out || '').toUpperCase()) ? String(squat_rack_in_out).toUpperCase() : 'OUT';
    const safeBenchSafety = String(bench_safety_height || '4').substring(0, MAX_RACK);
    const safeBenchBlocks = ['Y', 'N'].includes(String(bench_blocks || '').toUpperCase()) ? String(bench_blocks).toUpperCase() : 'N';

    const createTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO lifters (
          id, meet_id, name, team, division_id, weight_class_id, gender, body_weight, 
          lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height,
          squat_rack_in_out, bench_safety_height, bench_blocks
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, meet_id, name.trim(), team || '', division_id || null, weight_class_id || null, 
        parsedGender, body_weight || null, lot_number || null, flight || 'A', platform || 1, 
        safeRackHeight, safeSquatRack, safeBenchRack,
        safeSquatInOut, safeBenchSafety, safeBenchBlocks
      );

      // Create placeholder attempts (3 per lift type)
      const insertAttempt = db.prepare('INSERT INTO attempts (id, lifter_id, lift_type, attempt_number) VALUES (?, ?, ?, ?)');
      ['squat', 'bench', 'deadlift'].forEach(liftType => {
        for (let num = 1; num <= 3; num++) {
          insertAttempt.run(generateId(), id, liftType, num);
        }
      });
    });

    createTx();

    const lifter = db.prepare('SELECT * FROM lifters WHERE id = ?').get(id);
    lifter.attempts = db.prepare('SELECT * FROM attempts WHERE lifter_id = ?').all(id);
    res.status(201).json(lifter);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update lifter
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const lifter = db.prepare('SELECT * FROM lifters WHERE id = ?').get(req.params.id);
    if (!lifter) return res.status(404).json({ error: 'Lifter not found' });

    const { 
      name, team, division_id, weight_class_id, gender, body_weight, 
      lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height,
      squat_rack_in_out, bench_safety_height, bench_blocks
    } = req.body;
    
    // Validate inputs
    if (name !== undefined) {
      if (!name || name.trim().length === 0) return res.status(400).json({ error: 'Lifter name cannot be empty' });
      if (name.trim().length > MAX_NAME) return res.status(400).json({ error: `Name must be ${MAX_NAME} characters or fewer` });
    }
    if (team && team.length > MAX_TEAM) return res.status(400).json({ error: `Team must be ${MAX_TEAM} characters or fewer` });

    if (body_weight !== undefined && body_weight !== null && body_weight !== '') {
      const bw = parseFloat(body_weight);
      if (isNaN(bw) || bw <= 0) return res.status(400).json({ error: 'Body weight must be a positive number' });
    }

    let parsedGender = lifter.gender;
    if (gender !== undefined) {
      const g = String(gender).trim().toUpperCase();
      if (!['M', 'F', 'X'].includes(g)) return res.status(400).json({ error: 'Gender must be "M", "F", or "X"' });
      parsedGender = g;
    }

    const resolvedDivision = division_id !== undefined ? (division_id || null) : lifter.division_id;
    const resolvedWeightClass = weight_class_id !== undefined ? (weight_class_id || null) : lifter.weight_class_id;

    const safeRackHeight = rack_height !== undefined ? String(rack_height || '').substring(0, MAX_RACK) : lifter.rack_height;
    const safeSquatRack = squat_rack_height !== undefined ? String(squat_rack_height || '').substring(0, MAX_RACK) : lifter.squat_rack_height;
    const safeBenchRack = bench_rack_height !== undefined ? String(bench_rack_height || '').substring(0, MAX_RACK) : lifter.bench_rack_height;
    const safeSquatInOut = squat_rack_in_out !== undefined ? (['IN', 'OUT'].includes(String(squat_rack_in_out).toUpperCase()) ? String(squat_rack_in_out).toUpperCase() : 'OUT') : lifter.squat_rack_in_out;
    const safeBenchSafety = bench_safety_height !== undefined ? String(bench_safety_height || '4').substring(0, MAX_RACK) : lifter.bench_safety_height;
    const safeBenchBlocks = bench_blocks !== undefined ? (['Y', 'N'].includes(String(bench_blocks).toUpperCase()) ? String(bench_blocks).toUpperCase() : 'N') : lifter.bench_blocks;
    
    db.prepare(`
      UPDATE lifters SET name = ?, team = ?, division_id = ?, weight_class_id = ?, gender = ?, body_weight = ?,
      lot_number = ?, flight = ?, platform = ?, rack_height = ?, squat_rack_height = ?, bench_rack_height = ?,
      squat_rack_in_out = ?, bench_safety_height = ?, bench_blocks = ?
      WHERE id = ?
    `).run(
      name !== undefined ? name.trim() : lifter.name, 
      team !== undefined ? team : lifter.team, 
      resolvedDivision, resolvedWeightClass,
      parsedGender,
      body_weight !== undefined ? (body_weight === '' ? null : body_weight) : lifter.body_weight, 
      lot_number !== undefined ? lot_number : lifter.lot_number,
      flight !== undefined ? flight : lifter.flight, 
      platform !== undefined ? platform : lifter.platform,
      safeRackHeight, safeSquatRack, safeBenchRack,
      safeSquatInOut, safeBenchSafety, safeBenchBlocks,
      req.params.id
    );

    res.json(db.prepare('SELECT * FROM lifters WHERE id = ?').get(req.params.id));
    
    // Broadcast generic meet update event so clients refresh their lifter cache
    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ type: 'meet_updated', data: { meetId: lifter.meet_id } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk update lifters (e.g., move to another flight or division)
router.patch('/bulk', (req, res) => {
  try {
    const db = getDb();
    const { ids, flight, division_id } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of lifter ids is required' });
    }
    if (ids.length > 500) {
      return res.status(400).json({ error: 'Bulk update limited to 500 lifters at a time' });
    }

    // Validation for flight
    if (flight !== undefined && (typeof flight !== 'string' || flight.length > 5)) {
      return res.status(400).json({ error: 'Invalid flight designation' });
    }

    const updateTx = db.transaction(() => {
      if (flight !== undefined) {
        const stmt = db.prepare('UPDATE lifters SET flight = ? WHERE id = ?');
        for (const id of ids) {
          stmt.run(flight, id);
        }
      }
      if (division_id !== undefined) {
        const stmt = db.prepare('UPDATE lifters SET division_id = ? WHERE id = ?');
        for (const id of ids) {
          stmt.run(division_id || null, id);
        }
      }
    });

    updateTx();
    res.json({ success: true, updated: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk delete lifters
router.delete('/bulk', (req, res) => {
  try {
    const db = getDb();
    const { meetId, ids } = req.body;
    
    if (!meetId && (!ids || !Array.isArray(ids) || ids.length === 0)) {
      return res.status(400).json({ error: 'Either meetId or list of ids is required' });
    }
    if (ids && ids.length > 500) {
      return res.status(400).json({ error: 'Bulk delete limited to 500 lifters at a time' });
    }

    const deleteTx = db.transaction((mId, lifterIds) => {
      if (mId) {
        db.prepare('DELETE FROM lifters WHERE meet_id = ?').run(mId);
        db.prepare("UPDATE meet_state SET current_lifter_id = '' WHERE meet_id = ?").run(mId);
      } else if (lifterIds && lifterIds.length > 0) {
        const stmt = db.prepare('DELETE FROM lifters WHERE id = ?');
        const clearStateStmt = db.prepare("UPDATE meet_state SET current_lifter_id = '' WHERE current_lifter_id = ?");
        for (const id of lifterIds) {
          stmt.run(id);
          clearStateStmt.run(id);
        }
      }
    });

    deleteTx(meetId, ids);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Bulk delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete lifter
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const lifter = db.prepare('SELECT meet_id FROM lifters WHERE id = ?').get(req.params.id);
    if (!lifter) return res.status(404).json({ error: 'Lifter not found' });

    const deleteTx = db.transaction(() => {
      // Clear from meet_state if this lifter is currently on the platform
      db.prepare("UPDATE meet_state SET current_lifter_id = '' WHERE current_lifter_id = ?").run(req.params.id);
      db.prepare('DELETE FROM lifters WHERE id = ?').run(req.params.id);
    });

    deleteTx();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV Import (Memory-based, safe and transactional)
router.post('/import/:meetId', upload.single('csv'), (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'No CSV file uploaded' });
  }

  const db = getDb();
  const meetId = req.params.meetId;

  // Verify meet exists
  const meet = db.prepare('SELECT id FROM meets WHERE id = ?').get(meetId);
  if (!meet) {
    return res.status(404).json({ error: 'Meet not found' });
  }

  try {
    const csvContent = req.file.buffer.toString('utf-8');
    const records = parse(csvContent, { 
      columns: true, 
      skip_empty_lines: true,
      trim: true,
      relaxColumnCount: true
    });

    if (records.length > 500) {
      return res.status(400).json({ error: 'CSV exceeds limit of 500 lifters. Please split your file.' });
    }

    const insertLifter = db.prepare(`
      INSERT INTO lifters (
        id, meet_id, name, team, division_id, weight_class_id, gender, body_weight, 
        lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height,
        squat_rack_in_out, bench_safety_height, bench_blocks
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAttempt = db.prepare('INSERT INTO attempts (id, lifter_id, lift_type, attempt_number) VALUES (?, ?, ?, ?)');

    const importTransaction = db.transaction((records) => {
      let imported = 0;
      const errors = [];

      // Cache existing divisions/weight classes inside transaction
      let divisions = db.prepare('SELECT * FROM divisions WHERE meet_id = ?').all(meetId);
      let weightClasses = db.prepare(`
        SELECT wc.* FROM weight_classes wc 
        JOIN divisions d ON wc.division_id = d.id 
        WHERE d.meet_id = ?
      `).all(meetId);

      records.forEach((record, idx) => {
        try {
          const name = record.Name || record.name || record.Lifter || record.lifter || '';
          if (!name || !name.trim()) {
            errors.push(`Row ${idx + 1}: No name found`);
            return;
          }

          const team = record.Team || record.team || '';
          const rawBw = record['Body Weight'] || record.body_weight || record.BodyWeight || record.Weight || '0';
          const bodyWeight = parseFloat(String(rawBw).replace(/[^\d.]/g, '')) || null;
          
          const rawLot = record.Lot || record.lot || record['Lot Number'] || '0';
          const lot = parseInt(String(rawLot).replace(/\D/g, ''), 10) || null;
          
          const flight = String(record.Flight || record.flight || 'A').trim().toUpperCase().substring(0, 5) || 'A';
          const platform = parseInt(record.Platform || record.platform || 1, 10) || 1;
          
          let parsedGender = (record.Gender || record.gender || record.Sex || record.sex || 'M').toString().trim().toUpperCase().charAt(0);
          if (!['M', 'F', 'X'].includes(parsedGender)) parsedGender = 'M';
          
          // Match or auto-create division
          let divName = (record.Division || record.division || '').trim();
          let matchedDiv = divName ? divisions.find(d => d.name.toLowerCase() === divName.toLowerCase()) : null;
          
          if (divName && !matchedDiv) {
            matchedDiv = { id: generateId(), meet_id: meetId, name: divName.substring(0, 100), sort_order: divisions.length };
            db.prepare('INSERT INTO divisions (id, meet_id, name, sort_order) VALUES (?, ?, ?, ?)').run(
              matchedDiv.id, matchedDiv.meet_id, matchedDiv.name, matchedDiv.sort_order
            );
            divisions.push(matchedDiv);
          }
          
          // Match or auto-create weight class
          let wcName = (record['Weight Class'] || record.weight_class || record.WeightClass || '').trim();
          let matchedWc = wcName ? weightClasses.find(wc => 
            wc.name.toLowerCase() === wcName.toLowerCase() && 
            (!matchedDiv || wc.division_id === matchedDiv.id)
          ) : null;
          
          if (wcName && !matchedWc && matchedDiv) {
            let parsedMax = parseFloat(wcName);
            const isPlus = wcName.includes('+');
            if (isNaN(parsedMax) || isPlus) parsedMax = null;
            
            matchedWc = { 
              id: generateId(), 
              division_id: matchedDiv.id, 
              name: wcName.substring(0, 50), 
              max_weight: parsedMax, 
              sort_order: weightClasses.filter(w => w.division_id === matchedDiv.id).length 
            };
            db.prepare('INSERT INTO weight_classes (id, division_id, name, max_weight, sort_order) VALUES (?, ?, ?, ?, ?)').run(
              matchedWc.id, matchedWc.division_id, matchedWc.name, matchedWc.max_weight, matchedWc.sort_order
            );
            weightClasses.push(matchedWc);
          }

          const squatRack = String(record['Squat Rack'] || record.squat_rack || record.squat_rack_height || '').substring(0, MAX_RACK);
          let squatInOut = (record['Squat In/Out'] || record.squat_rack_in_out || record.squat_in_out || 'OUT').trim().toUpperCase();
          if (!['IN', 'OUT'].includes(squatInOut)) squatInOut = 'OUT';
          
          const benchRack = String(record['Bench Rack'] || record.bench_rack || record.bench_rack_height || '').substring(0, MAX_RACK);
          const rackHeight = String(record['Rack Height'] || record.rack_height || record.Rack || '').substring(0, MAX_RACK);
          const benchSafety = String(record['Bench Safety'] || record.bench_safety || record.bench_safety_height || '4').substring(0, MAX_RACK);
          let benchBlocks = (record['Bench Blocks'] || record.bench_blocks || 'N').trim().toUpperCase().charAt(0);
          if (!['Y', 'N'].includes(benchBlocks)) benchBlocks = 'N';

          const lifterId = generateId();
          insertLifter.run(
            lifterId, meetId, name.trim().substring(0, MAX_NAME), team.trim().substring(0, MAX_TEAM),
            matchedDiv?.id || null, matchedWc?.id || null,
            parsedGender, bodyWeight, lot, flight, platform,
            rackHeight, squatRack, benchRack, squatInOut, benchSafety, benchBlocks
          );

          // Create attempt placeholders
          ['squat', 'bench', 'deadlift'].forEach(liftType => {
            for (let num = 1; num <= 3; num++) {
              insertAttempt.run(generateId(), lifterId, liftType, num);
            }
            // Check for opener weights in CSV
            const openerKey = `${liftType.charAt(0).toUpperCase() + liftType.slice(1)} Opener`;
            const openerAlt = `${liftType}_opener`;
            const rawOpener = record[openerKey] || record[openerAlt] || '0';
            const opener = parseFloat(String(rawOpener).replace(/[^\d.]/g, '')) || 0;
            if (opener > 0) {
              db.prepare('UPDATE attempts SET weight = ? WHERE lifter_id = ? AND lift_type = ? AND attempt_number = 1').run(
                opener, lifterId, liftType
              );
            }
          });

          imported++;
        } catch (e) {
          errors.push(`Row ${idx + 1}: ${e.message}`);
        }
      });

      return { imported, errors };
    });

    const result = importTransaction(records);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ error: `CSV parsing failed: ${e.message}` });
  }
});

module.exports = router;
