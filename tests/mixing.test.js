const { setup, teardown, seedRoleAgents, createUser, loginAgent } = require('./helpers');

let app;
let agents;

beforeAll(async () => {
  app = await setup();
  ({ agents } = await seedRoleAgents(app));
});
afterAll(teardown);

async function createRequest(agent = agents.client, hex = '#88AACC') {
  const res = await agent.post('/api/mixing/requests').send({
    targetColor: { hex, name: 'Test Shade' },
    quantity: 1,
  });
  expect(res.status).toBe(201);
  return res.body.data.request;
}

describe('mix request lifecycle', () => {
  it('walks queued -> mixing -> completed while recording a new formula', async () => {
    const request = await createRequest();

    await agents.paint_mixer.post(`/api/mixing/requests/${request.id}/start`);

    const complete = await agents.paint_mixer
      .post(`/api/mixing/requests/${request.id}/complete`)
      .send({
        newFormula: {
          name: 'Hazy Sky (test)',
          colorHex: '#88AACC',
          components: [{ name: 'White base', amount: 3.5, unit: 'mL' }],
        },
        mixerNotes: 'Matched under daylight',
      });

    expect(complete.status).toBe(200);
    expect(complete.body.data.request.status).toBe('completed');
    expect(complete.body.data.formula.timesUsed).toBe(1);
  });

  it('increments timesUsed when reusing a formula, and refuses archived ones', async () => {
    const formulaId = (await agents.paint_mixer.get('/api/formulas?search=Hazy')).body.data
      .formulas[0].id;

    const second = await createRequest();
    const reuse = await agents.paint_mixer
      .post(`/api/mixing/requests/${second.id}/complete`)
      .send({ formulaId });
    expect(reuse.body.data.formula.timesUsed).toBe(2);

    await agents.paint_mixer.delete(`/api/formulas/${formulaId}`);
    const third = await createRequest();
    const blocked = await agents.paint_mixer
      .post(`/api/mixing/requests/${third.id}/complete`)
      .send({ formulaId });
    expect(blocked.status).toBe(400);
  });

  it('lets clients cancel only while queued', async () => {
    const request = await createRequest();
    await agents.paint_mixer.post(`/api/mixing/requests/${request.id}/start`);

    const res = await agents.client.post(`/api/mixing/requests/${request.id}/cancel`);
    expect(res.status).toBe(409);
  });

  it('scopes clients to their own requests', async () => {
    await createUser({ email: 'other-mixer-client@test.com' });
    const other = await loginAgent(app, 'other-mixer-client@test.com');
    const foreign = await createRequest(other, '#112233');

    const list = await agents.client.get('/api/mixing/requests?limit=50');
    const ids = list.body.data.requests.map((r) => r.id);
    expect(ids).not.toContain(foreign.id);

    // Direct access to someone else's request is a 404, not a 403 leak.
    expect((await agents.client.get(`/api/mixing/requests/${foreign.id}`)).status).toBe(404);
  });

  it('rejects invalid target colors', async () => {
    const res = await agents.client.post('/api/mixing/requests').send({
      targetColor: { hex: 'blue' },
    });
    expect(res.status).toBe(422);
  });
});
