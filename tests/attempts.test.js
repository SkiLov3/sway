const request = require('supertest');
const { app } = require('../server');
const { getDb, resetDb } = require('../db');

describe('Attempts API', () => {
  let db;
  let lifterId;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = getDb(':memory:');
    
    // Create meet and lifter
    const meetRes = await request(app).post('/api/meets').send({ name: 'Test Meet' });
    const lifterRes = await request(app).post('/api/lifters').send({ meet_id: meetRes.body.id, name: 'John Doe' });
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
});
