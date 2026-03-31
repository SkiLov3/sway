const { getDb, generateId } = require('./db');
const db = getDb();

const meetId = generateId();
db.exec(`INSERT INTO meets (id, name, date, federation, status) VALUES ('${meetId}', 'Test Meet', '2026-04-01', 'USAPL', 'running')`);

const divId = generateId();
db.exec(`INSERT INTO divisions (id, meet_id, name) VALUES ('${divId}', '${meetId}', 'Open')`);

const wcId = generateId();
db.exec(`INSERT INTO weight_classes (id, division_id, name, max_weight) VALUES ('${wcId}', '${divId}', '90', 90)`);

const l1 = generateId();
const l2 = generateId();
const l3 = generateId();

// L1: 89kg male. Total 600kg.
// L2: 88kg male. Total 600kg. (Should win tie-breaker)
// L3: 65kg female. Total 400kg. (Will be best lifter on DOTS)
db.exec(`INSERT INTO lifters (id, meet_id, name, division_id, weight_class_id, gender, body_weight) VALUES 
  ('${l1}', '${meetId}', 'Lifter A (Heavy Tie)', '${divId}', '${wcId}', 'M', 89.0),
  ('${l2}', '${meetId}', 'Lifter B (Light Tie)', '${divId}', '${wcId}', 'M', 88.0),
  ('${l3}', '${meetId}', 'Lifter C (Woman)', '${divId}', '${wcId}', 'F', 65.0)`);

const id1 = generateId();
const id2 = generateId();
const id3 = generateId();
const id4 = generateId();
const id5 = generateId();
const id6 = generateId();
const id7 = generateId();
const id8 = generateId();
const id9 = generateId();

db.exec(`INSERT INTO attempts (id, lifter_id, lift_type, attempt_number, weight, result) VALUES 
  ('${id1}', '${l1}', 'squat', 1, 200, 'good'),
  ('${id2}', '${l1}', 'bench', 1, 150, 'good'),
  ('${id3}', '${l1}', 'deadlift', 1, 250, 'good'),
  
  ('${id4}', '${l2}', 'squat', 1, 200, 'good'),
  ('${id5}', '${l2}', 'bench', 1, 150, 'good'),
  ('${id6}', '${l2}', 'deadlift', 1, 250, 'good'),
  
  ('${id7}', '${l3}', 'squat', 1, 150, 'good'),
  ('${id8}', '${l3}', 'bench', 1, 100, 'good'),
  ('${id9}', '${l3}', 'deadlift', 1, 150, 'good')`);

console.log(meetId);
