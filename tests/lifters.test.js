const request = require('supertest');
const { app } = require('../server');
const { getDb, resetDb } = require('../db');

describe('Lifters API', () => {
  let db;
  let meetId;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = getDb(':memory:');
    
    // Create a meet for lifters
    const meet = await request(app).post('/api/meets').send({ name: 'Test Meet' });
    meetId = meet.body.id;
  });

  afterAll(() => {
    resetDb();
  });

  beforeEach(() => {
    db.exec('DELETE FROM lifters');
    db.exec('DELETE FROM attempts');
  });

  test('POST /api/lifters should create a lifter with default attempts', async () => {
    const res = await request(app)
      .post('/api/lifters')
      .send({
        meet_id: meetId,
        name: 'Jane Doe',
        gender: 'F',
        body_weight: 60.5
      });
    
    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Jane Doe');
    expect(res.body.attempts).toHaveLength(9); // 3 squat + 3 bench + 3 deadlift
    
    const lifter = db.prepare('SELECT * FROM lifters WHERE id = ?').get(res.body.id);
    expect(lifter).toBeDefined();
    expect(lifter.body_weight).toBe(60.5);
  });

  test('POST /api/lifters should fail with invalid body weight or invalid meet', async () => {
    const res = await request(app)
      .post('/api/lifters')
      .send({
        meet_id: meetId,
        name: 'Jane Doe',
        body_weight: -10
      });
    expect(res.statusCode).toBe(400);

    const resNoMeet = await request(app)
      .post('/api/lifters')
      .send({
        meet_id: 'nonexistent-meet-id',
        name: 'Jane Doe'
      });
    expect(resNoMeet.statusCode).toBe(404);
  });

  test('PUT /api/lifters/:id should update lifter details and validate gender', async () => {
    const createRes = await request(app)
      .post('/api/lifters')
      .send({ meet_id: meetId, name: 'Original Name' });
    
    const id = createRes.body.id;
    const res = await request(app)
      .put(`/api/lifters/${id}`)
      .send({ name: 'Updated Name', team: 'Strong Team', gender: 'F' });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.team).toBe('Strong Team');
    expect(res.body.gender).toBe('F');

    // Reject invalid gender
    const invalidGenderRes = await request(app)
      .put(`/api/lifters/${id}`)
      .send({ gender: 'INVALID' });
    expect(invalidGenderRes.statusCode).toBe(400);
  });

  test('DELETE /api/lifters/:id should remove lifter, cascade attempts, and clear meet_state', async () => {
    const createRes = await request(app)
      .post('/api/lifters')
      .send({ meet_id: meetId, name: 'To Be Deleted' });
    
    const id = createRes.body.id;

    // Set this lifter as current lifter in meet_state
    db.prepare('UPDATE meet_state SET current_lifter_id = ? WHERE meet_id = ?').run(id, meetId);
    expect(db.prepare('SELECT current_lifter_id FROM meet_state WHERE meet_id = ?').get(meetId).current_lifter_id).toBe(id);

    const res = await request(app).delete(`/api/lifters/${id}`);
    expect(res.statusCode).toBe(200);
    
    const lifter = db.prepare('SELECT * FROM lifters WHERE id = ?').get(id);
    expect(lifter).toBeUndefined();
    
    const attempts = db.prepare('SELECT * FROM attempts WHERE lifter_id = ?').all(id);
    expect(attempts).toHaveLength(0);

    // Verify current_lifter_id was cleared in meet_state
    const state = db.prepare('SELECT current_lifter_id FROM meet_state WHERE meet_id = ?').get(meetId);
    expect(state.current_lifter_id).toBe('');
  });

  test('PATCH and DELETE /api/lifters/bulk should reject requests exceeding 500 ids', async () => {
    const oversizedIds = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    
    const patchRes = await request(app).patch('/api/lifters/bulk').send({ ids: oversizedIds, flight: 'B' });
    expect(patchRes.statusCode).toBe(400);

    const deleteRes = await request(app).delete('/api/lifters/bulk').send({ ids: oversizedIds });
    expect(deleteRes.statusCode).toBe(400);
  });

  test('POST /api/lifters/import/:meetId should import from CSV', async () => {
    const res = await request(app)
      .post(`/api/lifters/import/${meetId}`)
      .attach('csv', 'tests/sample.csv');
    
    expect(res.statusCode).toBe(200);
    expect(res.body.imported).toBe(3);
    
    const lifters = db.prepare('SELECT * FROM lifters WHERE meet_id = ?').all(meetId);
    expect(lifters).toHaveLength(3);
    
    const alice = lifters.find(l => l.name === 'Alice');
    expect(alice.gender).toBe('F');
    expect(alice.body_weight).toBe(60);
    
    // Check opener
    const opener = db.prepare('SELECT * FROM attempts WHERE lifter_id = ? AND lift_type = ? AND attempt_number = 1')
      .get(alice.id, 'squat');
    expect(opener.weight).toBe(100);
  });
});
