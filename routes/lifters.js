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
    const { meet_id, name, team, division_id, weight_class_id, gender, body_weight, lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height } = req.body;
    
    if (!meet_id) return res.status(400).json({ error: 'meet_id is required' });
    if (!name || name.trim().length === 0) return res.status(400).json({ error: 'Lifter name is required' });
    if (name.trim().length > MAX_NAME) return res.status(400).json({ error: `Name must be ${MAX_NAME} characters or fewer` });
    if (team && team.length > MAX_TEAM) return res.status(400).json({ error: `Team must be ${MAX_TEAM} characters or fewer` });
    
    db.prepare(`
      INSERT INTO lifters (id, meet_id, name, team, division_id, weight_class_id, gender, body_weight, lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, meet_id, name.trim(), team || '', division_id || null, weight_class_id || null, 
      gender || 'M', body_weight || null, lot_number || null, flight || 'A', platform || 1, 
      rack_height || '', squat_rack_height || '', bench_rack_height || '');

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

    const { name, team, division_id, weight_class_id, gender, body_weight, lot_number, flight, platform, rack_height, squat_rack_height, bench_rack_height } = req.body;
    
    // Handle empty string for nullable FK fields — treat '' as null
    const resolvedDivision = division_id !== undefined ? (division_id || null) : lifter.division_id;
    const resolvedWeightClass = weight_class_id !== undefined ? (weight_class_id || null) : lifter.weight_class_id;
    
    db.prepare(`
      UPDATE lifters SET name = ?, team = ?, division_id = ?, weight_class_id = ?, gender = ?, body_weight = ?,
      lot_number = ?, flight = ?, platform = ?, rack_height = ?, squat_rack_height = ?, bench_rack_height = ?
      WHERE id = ?
    `).run(
      name ?? lifter.name, team ?? lifter.team, 
      resolvedDivision, resolvedWeightClass,
      gender ?? lifter.gender,
      body_weight ?? lifter.body_weight, lot_number ?? lifter.lot_number,
      flight ?? lifter.flight, platform ?? lifter.platform,
      rack_height ?? lifter.rack_height, squat_rack_height ?? lifter.squat_rack_height,
      bench_rack_height ?? lifter.bench_rack_height,
      req.params.id
    );

    res.json(db.prepare('SELECT * FROM lifters WHERE id = ?').get(req.params.id));
  } catch (err) {
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

  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(csvContent, { 
      columns: true, 
      skip_empty_lines: true,
      trim: true,
      relaxColumnCount: true
    });

    const insertLifter = db.prepare(`
      INSERT INTO lifters (id, meet_id, name, team, division_id, weight_class_id, gender, body_weight, lot_number, flight, platform)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAttempt = db.prepare('INSERT INTO attempts (id, lifter_id, lift_type, attempt_number) VALUES (?, ?, ?, ?)');

    // Get existing divisions and weight classes for matching
    const divisions = db.prepare('SELECT * FROM divisions WHERE meet_id = ?').all(meetId);
    const weightClasses = db.prepare(`
      SELECT wc.* FROM weight_classes wc 
      JOIN divisions d ON wc.division_id = d.id 
      WHERE d.meet_id = ?
    `).all(meetId);

    const importTransaction = db.transaction((records) => {
      let imported = 0;
      const errors = [];

      records.forEach((record, idx) => {
        try {
          const name = record.Name || record.name || record.Lifter || record.lifter || '';
          if (!name) {
            errors.push(`Row ${idx + 1}: No name found`);
            return;
          }

          const team = record.Team || record.team || '';
          const bodyWeight = parseFloat(record['Body Weight'] || record.body_weight || record.BodyWeight || record.Weight || 0) || null;
          const lot = parseInt(record.Lot || record.lot || record['Lot Number'] || 0) || null;
          const flight = record.Flight || record.flight || 'A';
          const platform = parseInt(record.Platform || record.platform || 1) || 1;
          
          let parsedGender = (record.Gender || record.gender || record.Sex || record.sex || 'M').trim().toUpperCase().charAt(0);
          if (!['M', 'F', 'X'].includes(parsedGender)) parsedGender = 'M';
          
          // Try to match division
          const divName = record.Division || record.division || '';
          const matchedDiv = divisions.find(d => d.name.toLowerCase() === divName.toLowerCase());
          
          // Try to match weight class
          const wcName = record['Weight Class'] || record.weight_class || record.WeightClass || '';
          const matchedWc = weightClasses.find(wc => 
            wc.name.toLowerCase() === wcName.toLowerCase() && 
            (!matchedDiv || wc.division_id === matchedDiv.id)
          );

          const lifterId = generateId();
          insertLifter.run(
            lifterId, meetId, name, team,
            matchedDiv?.id || null, matchedWc?.id || null,
            parsedGender, bodyWeight, lot, flight, platform
          );

          // Create attempt placeholders
          ['squat', 'bench', 'deadlift'].forEach(liftType => {
            for (let num = 1; num <= 3; num++) {
              insertAttempt.run(generateId(), lifterId, liftType, num);
            }
            // Check for opener weights in CSV
            const openerKey = `${liftType.charAt(0).toUpperCase() + liftType.slice(1)} Opener`;
            const openerAlt = `${liftType}_opener`;
            const opener = parseFloat(record[openerKey] || record[openerAlt] || 0);
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
