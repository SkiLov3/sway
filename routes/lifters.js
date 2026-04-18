const express = require('express');
const { getDb, generateId } = require('../db');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configure multer for CSV uploads — CSV only, 5 MB max
const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'text/csv'
      || file.mimetype === 'application/vnd.ms-excel'
      || file.originalname.toLowerCase().endsWith('.csv');
    if (!ok) return cb(new Error('Only CSV files are accepted'), false);
    cb(null, true);
  },
});

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

// Helper: field length guard
const MAX_NAME = 200;
const MAX_TEAM = 200;
const MAX_RACK = 20;

// Create lifter
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const id = generateId();
    const { 
      meet_id, name, team, division_id, weight_class_id, gender, body_weight, 
      lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height,
      bench_safety_height, bench_blocks
    } = req.body;
    
    if (!meet_id) return res.status(400).json({ error: 'meet_id is required' });
    if (!name || name.trim().length === 0) return res.status(400).json({ error: 'Lifter name is required' });
    if (name.trim().length > MAX_NAME) return res.status(400).json({ error: `Name must be ${MAX_NAME} characters or fewer` });
    if (team && team.length > MAX_TEAM) return res.status(400).json({ error: `Team must be ${MAX_TEAM} characters or fewer` });
    
    if (body_weight !== undefined && body_weight !== null) {
      const bw = parseFloat(body_weight);
      if (isNaN(bw) || bw <= 0) return res.status(400).json({ error: 'Body weight must be a positive number' });
    }
    
    db.prepare(`
      INSERT INTO lifters (
        id, meet_id, name, team, division_id, weight_class_id, gender, body_weight, 
        lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height,
        bench_safety_height, bench_blocks
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, meet_id, name.trim(), team || '', division_id || null, weight_class_id || null, 
      gender || 'M', body_weight || null, lot_number || null, flight || 'A', platform || 1, 
      rack_height || '', squat_rack_height || '', bench_rack_height || '',
      bench_safety_height || '4', bench_blocks || 'N');

    // Create placeholder attempts (3 per lift type)
    const insertAttempt = db.prepare('INSERT INTO attempts (id, lifter_id, lift_type, attempt_number) VALUES (?, ?, ?, ?)');
    ['squat', 'bench', 'deadlift'].forEach(liftType => {
      for (let num = 1; num <= 3; num++) {
        insertAttempt.run(generateId(), id, liftType, num);
      }
    });

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
      bench_safety_height, bench_blocks
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

    // Handle empty string for nullable FK fields — treat '' as null
    const resolvedDivision = division_id !== undefined ? (division_id || null) : lifter.division_id;
    const resolvedWeightClass = weight_class_id !== undefined ? (weight_class_id || null) : lifter.weight_class_id;
    
    db.prepare(`
      UPDATE lifters SET name = ?, team = ?, division_id = ?, weight_class_id = ?, gender = ?, body_weight = ?,
      lot_number = ?, flight = ?, platform = ?, rack_height = ?, squat_rack_height = ?, bench_rack_height = ?,
      bench_safety_height = ?, bench_blocks = ?
      WHERE id = ?
    `).run(
      name ?? lifter.name, team ?? lifter.team, 
      resolvedDivision, resolvedWeightClass,
      gender ?? lifter.gender,
      body_weight ?? lifter.body_weight, lot_number ?? lifter.lot_number,
      flight ?? lifter.flight, platform ?? lifter.platform,
      rack_height ?? lifter.rack_height, squat_rack_height ?? lifter.squat_rack_height,
      bench_rack_height ?? lifter.bench_rack_height,
      bench_safety_height ?? lifter.bench_safety_height, bench_blocks ?? lifter.bench_blocks,
      req.params.id
    );

    res.json(db.prepare('SELECT * FROM lifters WHERE id = ?').get(req.params.id));
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

    const deleteTx = db.transaction((mId, lifterIds) => {
      if (mId) {
        db.prepare('DELETE FROM lifters WHERE meet_id = ?').run(mId);
      } else if (lifterIds && lifterIds.length > 0) {
        const stmt = db.prepare('DELETE FROM lifters WHERE id = ?');
        for (const id of lifterIds) {
          stmt.run(id);
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
    db.prepare('DELETE FROM lifters WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV Import
router.post('/import/:meetId', upload.single('csv'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

  const db = getDb();
  const meetId = req.params.meetId;

  // Verify meet exists
  const meet = db.prepare('SELECT id FROM meets WHERE id = ?').get(meetId);
  if (!meet) {
    try { if (req.file) fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(404).json({ error: 'Meet not found' });
  }

  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(csvContent, { 
      columns: true, 
      skip_empty_lines: true,
      trim: true,
      relaxColumnCount: true
    });

    if (records.length > 500) {
      try { if (req.file) fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ error: 'CSV exceeds limit of 500 lifters. Please split your file.' });
    }

    const insertLifter = db.prepare(`
      INSERT INTO lifters (
        id, meet_id, name, team, division_id, weight_class_id, gender, body_weight, 
        lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height,
        bench_safety_height, bench_blocks
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAttempt = db.prepare('INSERT INTO attempts (id, lifter_id, lift_type, attempt_number) VALUES (?, ?, ?, ?)');

    const importTransaction = db.transaction((records) => {
      let imported = 0;
      const errors = [];

      // Refresh cache of divisions/weight classes inside transaction
      let divisions = db.prepare('SELECT * FROM divisions WHERE meet_id = ?').all(meetId);
      let weightClasses = db.prepare(`
        SELECT wc.* FROM weight_classes wc 
        JOIN divisions d ON wc.division_id = d.id 
        WHERE d.meet_id = ?
      `).all(meetId);

      records.forEach((record, idx) => {
        try {
          const name = record.Name || record.name || record.Lifter || record.lifter || '';
          if (!name) {
            errors.push(`Row ${idx + 1}: No name found`);
            return;
          }

          const team = record.Team || record.team || '';
          const rawBw = record['Body Weight'] || record.body_weight || record.BodyWeight || record.Weight || '0';
          const bodyWeight = parseFloat(String(rawBw).replace(/[^\d.]/g, '')) || null;
          
          const rawLot = record.Lot || record.lot || record['Lot Number'] || '0';
          const lot = parseInt(String(rawLot).replace(/\D/g, '')) || null;
          
          const flight = String(record.Flight || record.flight || 'A').trim().toUpperCase().substring(0, 5) || 'A';
          const platform = parseInt(record.Platform || record.platform || 1) || 1;
          
          let parsedGender = (record.Gender || record.gender || record.Sex || record.sex || 'M').trim().toUpperCase().charAt(0);
          if (!['M', 'F', 'X'].includes(parsedGender)) parsedGender = 'M';
          
          // Try to match or auto-create division
          let divName = (record.Division || record.division || '').trim();
          let matchedDiv = divName ? divisions.find(d => d.name.toLowerCase() === divName.toLowerCase()) : null;
          
          if (divName && !matchedDiv) {
            matchedDiv = { id: generateId(), meet_id: meetId, name: divName, sort_order: divisions.length };
            db.prepare('INSERT INTO divisions (id, meet_id, name, sort_order) VALUES (?, ?, ?, ?)').run(
              matchedDiv.id, matchedDiv.meet_id, matchedDiv.name, matchedDiv.sort_order
            );
            divisions.push(matchedDiv);
          }
          
          // Try to match or auto-create weight class
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
              name: wcName, 
              max_weight: parsedMax, 
              sort_order: weightClasses.filter(w => w.division_id === matchedDiv.id).length 
            };
            db.prepare('INSERT INTO weight_classes (id, division_id, name, max_weight, sort_order) VALUES (?, ?, ?, ?, ?)').run(
              matchedWc.id, matchedWc.division_id, matchedWc.name, matchedWc.max_weight, matchedWc.sort_order
            );
            weightClasses.push(matchedWc);
            weightClasses.push(matchedWc); // Keep local cache updated
          }

          const squatRack = String(record['Squat Rack'] || record.squat_rack || record.squat_rack_height || '').substring(0, 20);
          const benchRack = String(record['Bench Rack'] || record.bench_rack || record.bench_rack_height || '').substring(0, 20);
          const rackHeight = String(record['Rack Height'] || record.rack_height || record.Rack || '').substring(0, 20);
          const benchSafety = String(record['Bench Safety'] || record.bench_safety || record.bench_safety_height || '4').substring(0, 20);
          let benchBlocks = (record['Bench Blocks'] || record.bench_blocks || 'N').trim().toUpperCase().charAt(0);
          if (!['Y', 'N'].includes(benchBlocks)) benchBlocks = 'N';

          const lifterId = generateId();
          insertLifter.run(
            lifterId, meetId, name.trim().substring(0, 200), team.trim().substring(0, 200),
            matchedDiv?.id || null, matchedWc?.id || null,
            parsedGender, bodyWeight, lot, flight, platform,
            rackHeight, squatRack, benchRack, benchSafety, benchBlocks
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
    
    // Clean up uploaded file safely
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    
    res.json({ success: true, ...result });
  } catch (e) {
    try { if (req.file) fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(400).json({ error: `CSV parsing failed: ${e.message}` });
  }
});

module.exports = router;
