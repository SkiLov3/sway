const request = require('supertest');
const { app } = require('../server');
const { getDb, resetDb } = require('../db');

describe('Attempts API', () => {
  let db;
  let lifterId;
  let meetId;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = getDb(':memory:');
    
    // Create meet and lifter
    const meetRes = await request(app).post('/api/meets').send({ name: 'Test Meet' });
    meetId = meetRes.body.id;
    const lifterRes = await request(app).post('/api/lifters').send({ meet_id: meetId, name: 'John Doe', lot_number: 10 });
    lifterId = lifterRes.body.id;
  });

  afterAll(() => {
    resetDb();
  });

  test('PUT /api/attempts/set/:lifterId/:liftType/:num should set attempt weight', async () => {
    const res = await request(app)
      .put(`/api/attempts/set/${lifterId}/squat/1`)
      .send({ weight: 200 });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.weight).toBe(200);
    
    const attempt = db.prepare('SELECT * FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = ?')
      .get(lifterId, 'squat', 1);
    expect(attempt.weight).toBe(200);
  });

  test('PUT /api/attempts/set should reject non-positive weight or invalid lift types', async () => {
    const resNegative = await request(app)
      .put(`/api/attempts/set/${lifterId}/squat/1`)
      .send({ weight: -50 });
    expect(resNegative.statusCode).toBe(400);

    const resInvalidLift = await request(app)
      .put(`/api/attempts/set/${lifterId}/curls/1`)
      .send({ weight: 50 });
    expect(resInvalidLift.statusCode).toBe(400);

    const resInvalidAttemptNum = await request(app)
      .put(`/api/attempts/set/${lifterId}/squat/5`)
      .send({ weight: 210 });
    expect(resInvalidAttemptNum.statusCode).toBe(400);
  });

  test('PUT /api/attempts/set should enforce monotonic attempt progression', async () => {
    // Attempt 1 is 200 kg. Attempt 2 cannot be lower (e.g. 190 kg)
    const resProgressionFail = await request(app)
      .put(`/api/attempts/set/${lifterId}/squat/2`)
      .send({ weight: 190 });
    expect(resProgressionFail.statusCode).toBe(400);
    expect(resProgressionFail.body.error).toContain('cannot be less than');

    // Attempt 2 with >= 200 kg succeeds
    const resProgressionOk = await request(app)
      .put(`/api/attempts/set/${lifterId}/squat/2`)
      .send({ weight: 210 });
    expect(resProgressionOk.statusCode).toBe(200);
    expect(resProgressionOk.body.weight).toBe(210);
  });

  test('PUT /api/attempts/decision/:lifterId/:liftType/:num should record referee votes', async () => {
    // Vote 1: white, white, red -> good
    const res = await request(app)
      .put(`/api/attempts/decision/${lifterId}/squat/1`)
      .send({ ref1: 'white', ref2: 'white', ref3: 'red' });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.result).toBe('good');
    expect(res.body.ref1).toBe('white');
    expect(res.body.ref2).toBe('white');
    expect(res.body.ref3).toBe('red');
  });

  test('PUT /api/attempts/decision should record "no_good" for majority red', async () => {
    const res = await request(app)
      .put(`/api/attempts/decision/${lifterId}/squat/2`)
      .send({ ref1: 'red', ref2: 'white', ref3: 'red' });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.result).toBe('no_good');
  });

  test('PUT /api/attempts/decision should keep result "pending" when votes are incomplete', async () => {
    const res = await request(app)
      .put(`/api/attempts/decision/${lifterId}/squat/3`)
      .send({ ref1: 'white' });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.result).toBe('pending');
    expect(res.body.ref1).toBe('white');
  });

  test('PUT /api/attempts/set with null weight should clear the attempt', async () => {
    // Set weight first
    await request(app).put(`/api/attempts/set/${lifterId}/bench/1`).send({ weight: 100 });
    
    // Clear it
    const res = await request(app)
      .put(`/api/attempts/set/${lifterId}/bench/1`)
      .send({ weight: null });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.weight).toBe(null);
    expect(res.body.result).toBe('pending');
  });

  test('GET /api/attempts/order should return batch-sorted lifting order', async () => {
    // Create second lifter with lighter weight
    const lifter2Res = await request(app).post('/api/lifters').send({ meet_id: meetId, name: 'Lighter Lifter', lot_number: 2 });
    const lifter2Id = lifter2Res.body.id;
    await request(app).put(`/api/attempts/set/${lifter2Id}/squat/1`).send({ weight: 150 });

    const orderRes = await request(app).get(`/api/attempts/order/${meetId}/1/A/squat/1`);
    expect(orderRes.statusCode).toBe(200);
    expect(orderRes.body.length).toBeGreaterThanOrEqual(2);
    // Lighter lifter (150kg) should come before heavier lifter (200kg)
    expect(orderRes.body[0].name).toBe('Lighter Lifter');
  });
});
