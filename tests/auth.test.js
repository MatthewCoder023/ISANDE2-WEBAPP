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

  it('signs out every other session when the password changes', async () => {
    await createUser({ email: 'twodevices@test.com' });
    const phone = await loginAgent(app, 'twodevices@test.com');
    const laptop = await loginAgent(app, 'twodevices@test.com');

    const res = await laptop
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'Fresh9876' });
    expect(res.status).toBe(200);

    // The session that changed the password stays alive...
    expect((await laptop.get('/api/auth/me')).status).toBe(200);
    // ...but a stolen/other session is dead immediately.
    expect((await phone.get('/api/auth/me')).status).toBe(401);
  });
});

describe('hardening', () => {
  it('locks an account after repeated failed logins', async () => {
    await createUser({ email: 'bruteforce@test.com' });

    for (let i = 0; i < 5; i += 1) {
      const res = await supertest(app)
        .post('/api/auth/login')
        .send({ email: 'bruteforce@test.com', password: 'WrongPass1' });
      expect(res.status).toBe(401);
    }

    // Even the CORRECT password is refused while the account is locked.
    const locked = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'bruteforce@test.com', password: PASSWORD });
    expect(locked.status).toBe(429);
  });

  it('blocks state-changing requests from foreign origins', async () => {
    const res = await supertest(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'whoever@test.com', password: 'Whatever1' });
    expect(res.status).toBe(403);
  });

  it('rejects too-common passwords on registration', async () => {
    const res = await supertest(app).post('/api/auth/register').send({
      firstName: 'Weak',
      lastName: 'Password',
      email: 'weakpw@test.com',
      password: 'password123',
    });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('password');
  });
});

describe('password reset via email', () => {
  const { outbox } = require('../src/services/mail.service');

  it('emails a single-use link that resets the password and kills sessions', async () => {
    await createUser({ email: 'resetme@test.com' });
    const oldSession = await loginAgent(app, 'resetme@test.com');

    outbox.length = 0;
    const req = await supertest(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'resetme@test.com' });
    expect(req.status).toBe(200);
    expect(outbox).toHaveLength(1);
    const token = outbox[0].text.match(/token=([a-f0-9]+)/)[1];

    // The new password goes through the full validator stack.
    const weak = await supertest(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'password123' });
    expect(weak.status).toBe(422);

    const good = await supertest(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'Rested987' });
    expect(good.status).toBe(200);

    // The token is single-use.
    const reuse = await supertest(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'Another987' });
    expect(reuse.status).toBe(400);

    // Old password dead, new one works, and the pre-reset session is out.
    expect(
      (await supertest(app).post('/api/auth/login').send({ email: 'resetme@test.com', password: PASSWORD })).status
    ).toBe(401);
    expect(
      (await supertest(app).post('/api/auth/login').send({ email: 'resetme@test.com', password: 'Rested987' })).status
    ).toBe(200);
    expect((await oldSession.get('/api/auth/me')).status).toBe(401);
  });

  it('answers identically for unknown emails and sends nothing', async () => {
    outbox.length = 0;
    const res = await supertest(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'ghost@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If that email/);
    expect(outbox).toHaveLength(0);
  });
});
