const supertest = require('supertest');
const { setup, teardown, createUser, loginAgent, PASSWORD } = require('./helpers');

let app;
beforeAll(async () => {
  app = await setup();
});
afterAll(teardown);

describe('registration', () => {
  it('creates a client account and starts a session', async () => {
    const agent = supertest.agent(app);
    const res = await agent.post('/api/auth/register').send({
      firstName: 'New',
      lastName: 'Customer',
      email: 'new@test.com',
      password: 'Passw0rd1',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('client');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('new@test.com');
  });

  it('ignores an injected role — self-registration can never create staff', async () => {
    const res = await supertest(app).post('/api/auth/register').send({
      firstName: 'Eve',
      lastName: 'Attacker',
      email: 'eve@test.com',
      password: 'Passw0rd1',
      role: 'admin',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('client');
  });

  it('rejects a duplicate email with 409', async () => {
    const res = await supertest(app).post('/api/auth/register').send({
      firstName: 'Eve',
      lastName: 'Again',
      email: 'eve@test.com',
      password: 'Passw0rd1',
    });
    expect(res.status).toBe(409);
  });

  it('rejects weak passwords with field errors', async () => {
    const res = await supertest(app).post('/api/auth/register').send({
      firstName: 'Weak',
      lastName: 'Password',
      email: 'weak@test.com',
      password: 'short',
    });
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'password')).toBe(true);
  });
});

describe('login & sessions', () => {
  it('rejects a wrong password with the same message as an unknown email', async () => {
    await createUser({ email: 'carlos@test.com' });

    const wrongPassword = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'carlos@test.com', password: 'Nope1234' });
    const unknownEmail = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.com', password: 'Nope1234' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('blocks deactivated accounts from logging in', async () => {
    await createUser({ email: 'inactive@test.com', isActive: false });
    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'inactive@test.com', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('requires a session for /me and destroys it on logout', async () => {
    expect((await supertest(app).get('/api/auth/me')).status).toBe(401);

    const agent = await loginAgent(app, 'carlos@test.com');
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('self-service profile', () => {
  it('updates name and phone but never email', async () => {
    await createUser({ email: 'profile@test.com', firstName: 'Before' });
    const agent = await loginAgent(app, 'profile@test.com');

    const res = await agent
      .patch('/api/auth/profile')
      .send({ firstName: 'After', phone: '09171234567', email: 'hijack@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.firstName).toBe('After');
    expect(res.body.data.user.phone).toBe('09171234567');
    expect(res.body.data.user.email).toBe('profile@test.com');
  });

  it('changes the password only when the current one is correct', async () => {
    await createUser({ email: 'pwchange@test.com' });
    const agent = await loginAgent(app, 'pwchange@test.com');

    const wrong = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'WrongOne1', newPassword: 'Fresh9876' });
    expect(wrong.status).toBe(400);

    const right = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'Fresh9876' });
    expect(right.status).toBe(200);

    const oldLogin = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'pwchange@test.com', password: PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'pwchange@test.com', password: 'Fresh9876' });
    expect(newLogin.status).toBe(200);
  });
});
