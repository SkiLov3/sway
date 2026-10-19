const request = require('supertest');
const { app } = require('../server');
const { getDb, resetDb } = require('../db');

describe('Meets API', () => {
  let db;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    // Use in-memory DB for tests
    db = getDb(':memory:');
  });

  afterAll(() => {
    resetDb();
  });

  beforeEach(() => {
    // Clear tables before each test
    db.exec('DELETE FROM meets');
    db.exec('DELETE FROM meet_state');
    db.exec('DELETE FROM lifters');
    db.exec('DELETE FROM attempts');
  });

  test('GET /api/meets should return empty array initially', async () => {
    const res = await request(app).get('/api/meets');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/meets should create a new meet', async () => {
    const newMeet = {
      name: 'Test Meet',
      date: '2026-03-31',
      federation: 'USAPL'
    };
    const res = await request(app)
      .post('/api/meets')
      .send(newMeet);
    
    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Test Meet');
    expect(res.body.id).toBeDefined();
    
    // Verify it exists in DB
    const meet = db.prepare('SELECT * FROM meets WHERE id = ?').get(res.body.id);
    expect(meet).toBeDefined();
    expect(meet.name).toBe('Test Meet');
  });

  test('POST /api/meets should fail without a name', async () => {
    const res = await request(app)
      .post('/api/meets')
      .send({ date: '2026-03-31' });
    
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('GET /api/meets/:id should return a specific meet', async () => {
    const createRes = await request(app)
      .post('/api/meets')
      .send({ name: 'Find Me' });
    
    const id = createRes.body.id;
    const res = await request(app).get(`/api/meets/${id}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe('Find Me');
  });

  test('PUT /api/meets/:id should update a meet and validate status', async () => {
    const createRes = await request(app)
      .post('/api/meets')
      .send({ name: 'Update Me' });
    
    const id = createRes.body.id;
    const res = await request(app)
      .put(`/api/meets/${id}`)
      .send({ name: 'Updated Name', status: 'running' });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.status).toBe('running');

    // Reject invalid status
    const invalidStatusRes = await request(app)
      .put(`/api/meets/${id}`)
      .send({ status: 'invalid_status' });
    expect(invalidStatusRes.statusCode).toBe(400);
  });

  test('DELETE /api/meets/:id should remove a meet', async () => {
    const createRes = await request(app)
      .post('/api/meets')
      .send({ name: 'Delete Me' });
    
    const id = createRes.body.id;
    const res = await request(app).delete(`/api/meets/${id}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    
    const check = db.prepare('SELECT * FROM meets WHERE id = ?').get(id);
    expect(check).toBeUndefined();
  });

  test('POST /api/meets/:id/reset should non-destructively reset meet state and openers', async () => {
    // 404 for nonexistent meet
    const notFoundRes = await request(app).post('/api/meets/nonexistent-id/reset');
    expect(notFoundRes.statusCode).toBe(404);

    // Create meet and lifter with attempts
    const mRes = await request(app).post('/api/meets').send({ name: 'Reset Test' });
    const mid = mRes.body.id;
    const lRes = await request(app).post('/api/lifters').send({ meet_id: mid, name: 'Lifter 1' });
    const lid = lRes.body.id;

    // Set weights and decisions on attempts 1 and 2
    await request(app).put(`/api/attempts/set/${lid}/squat/1`).send({ weight: 100 });
    await request(app).put(`/api/attempts/decision/${lid}/squat/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });
    await request(app).put(`/api/attempts/set/${lid}/squat/2`).send({ weight: 110 });
    await request(app).put(`/api/attempts/decision/${lid}/squat/2`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });

    // Execute Reset
    const resetRes = await request(app).post(`/api/meets/${mid}/reset`);
    expect(resetRes.statusCode).toBe(200);
    expect(resetRes.body.success).toBe(true);

    // Verify Attempt 1 was reset to pending
    const att1 = db.prepare('SELECT * FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = 1').get(lid, 'squat');
    expect(att1.result).toBe('pending');
    expect(att1.ref1).toBe('');

    // Verify Attempt 2 was cleared BUT row was NOT deleted (non-destructive)
    const att2 = db.prepare('SELECT * FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = 2').get(lid, 'squat');
    expect(att2).toBeDefined();
    expect(att2.weight).toBeNull();
    expect(att2.result).toBe('pending');
  });

  test('GET /api/meets/:id/results should enforce powerlifting rules (bomb-outs, 4th attempts, ties)', async () => {
    // Create meet
    const mRes = await request(app).post('/api/meets').send({ name: 'Results Test', units: 'kg' });
    const mid = mRes.body.id;

    // 1. Normal lifter (Squat 200, Bench 150, Deadlift 250 = 600kg total, BW 90kg)
    const l1Res = await request(app).post('/api/lifters').send({
      meet_id: mid, name: 'Lifter Normal', gender: 'M', body_weight: 90, lot_number: 1, team: 'Iron Team'
    });
    const l1Id = l1Res.body.id;
    await request(app).put(`/api/attempts/set/${l1Id}/squat/1`).send({ weight: 200 });
    await request(app).put(`/api/attempts/decision/${l1Id}/squat/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });
    await request(app).put(`/api/attempts/set/${l1Id}/bench/1`).send({ weight: 150 });
    await request(app).put(`/api/attempts/decision/${l1Id}/bench/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });
    await request(app).put(`/api/attempts/set/${l1Id}/deadlift/1`).send({ weight: 250 });
    await request(app).put(`/api/attempts/decision/${l1Id}/deadlift/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });

    // 2. Bombed out lifter: failed all 3 squats, then benches 200 and deadlifts 300
    const l2Res = await request(app).post('/api/lifters').send({
      meet_id: mid, name: 'Lifter Bombout', gender: 'M', body_weight: 90, lot_number: 2, team: 'Iron Team'
    });
    const l2Id = l2Res.body.id;
    for (let att = 1; att <= 3; att++) {
      await request(app).put(`/api/attempts/set/${l2Id}/squat/${att}`).send({ weight: 200 });
      await request(app).put(`/api/attempts/decision/${l2Id}/squat/${att}`).send({ ref1: 'red', ref2: 'red', ref3: 'red' });
    }
    await request(app).put(`/api/attempts/set/${l2Id}/bench/1`).send({ weight: 200 });
    await request(app).put(`/api/attempts/decision/${l2Id}/bench/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });
    await request(app).put(`/api/attempts/set/${l2Id}/deadlift/1`).send({ weight: 300 });
    await request(app).put(`/api/attempts/decision/${l2Id}/deadlift/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });

    // 3. Lifter with a 4th attempt record (Squat 100, Bench 100, Deadlift 100 = 300kg total, but 4th DL attempt is 350kg)
    const l3Res = await request(app).post('/api/lifters').send({
      meet_id: mid, name: 'Lifter Record', gender: 'M', body_weight: 90, lot_number: 3
    });
    const l3Id = l3Res.body.id;
    await request(app).put(`/api/attempts/set/${l3Id}/squat/1`).send({ weight: 100 });
    await request(app).put(`/api/attempts/decision/${l3Id}/squat/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });
    await request(app).put(`/api/attempts/set/${l3Id}/bench/1`).send({ weight: 100 });
    await request(app).put(`/api/attempts/decision/${l3Id}/bench/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });
    await request(app).put(`/api/attempts/set/${l3Id}/deadlift/1`).send({ weight: 100 });
    await request(app).put(`/api/attempts/decision/${l3Id}/deadlift/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });
    // Add 4th attempt
    await request(app).put(`/api/attempts/set/${l3Id}/deadlift/4`).send({ weight: 350 });
    await request(app).put(`/api/attempts/decision/${l3Id}/deadlift/4`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });

    // 4. Gender X lifter
    const l4Res = await request(app).post('/api/lifters').send({
      meet_id: mid, name: 'Lifter Mx', gender: 'X', body_weight: 75, lot_number: 4
    });
    const l4Id = l4Res.body.id;
    await request(app).put(`/api/attempts/set/${l4Id}/squat/1`).send({ weight: 150 });
    await request(app).put(`/api/attempts/decision/${l4Id}/squat/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });
    await request(app).put(`/api/attempts/set/${l4Id}/bench/1`).send({ weight: 100 });
    await request(app).put(`/api/attempts/decision/${l4Id}/bench/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });
    await request(app).put(`/api/attempts/set/${l4Id}/deadlift/1`).send({ weight: 200 });
    await request(app).put(`/api/attempts/decision/${l4Id}/deadlift/1`).send({ ref1: 'white', ref2: 'white', ref3: 'white' });

    // Mark meet complete
    await request(app).put(`/api/meets/${mid}`).send({ status: 'complete' });

    const res = await request(app).get(`/api/meets/${mid}/results`);
    expect(res.statusCode).toBe(200);

    const normal = res.body.results.find(r => r.name === 'Lifter Normal');
    expect(normal.total).toBe(600);
    expect(normal.place).toBe(1);

    // Verify bombed out lifter receives total 0 and place '-'
    const bombout = res.body.results.find(r => r.name === 'Lifter Bombout');
    expect(bombout.bombedOut).toBe(true);
    expect(bombout.total).toBe(0);
    expect(bombout.place).toBe('-');

    // Verify 4th attempt was excluded from official total (100+100+100 = 300, not 550)
    const record = res.body.results.find(r => r.name === 'Lifter Record');
    expect(record.total).toBe(300);

    // Verify Gender X is partitioned into bestMx and excluded from bestMale
    expect(res.body.bestMx).toBeDefined();
    expect(res.body.bestMx.some(r => r.name === 'Lifter Mx')).toBe(true);
    expect(res.body.bestMale.some(r => r.name === 'Lifter Mx')).toBe(false);

    // Verify team standings
    expect(res.body.teamStandings).toBeDefined();
    expect(res.body.teamStandings[0].team).toBe('Iron Team');
    expect(res.body.teamStandings[0].points).toBe(12); // 1st place = 12 points
  });
});
