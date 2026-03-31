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

  test('PUT /api/meets/:id should update a meet', async () => {
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
});
