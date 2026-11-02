import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import User from '../src/models/User.js';
import Conversation from '../src/models/Conversation.js';
import { connectDatabase, mongoose } from '../src/config/database.js';
import { setFetchForTests } from '../src/services/llmProvider.js';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/app.js');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const userA = new User({ name: 'Chat Owner', email: `owner-${suffix}@example.test`, passwordHash: 'test-hash', isVerified: true });
const userB = new User({ name: 'Other Owner', email: `other-${suffix}@example.test`, passwordHash: 'test-hash', isVerified: true });
let server;
let baseUrl;
let failSynthesis = false;
const providerRequests = [];
process.env.LLM_MODEL = 'integration-test-model';
setFetchForTests(async (_url, options) => {
  const payload = JSON.parse(options.body);
  providerRequests.push(payload);
  const system = payload.messages[0].content;
  let content = 'A careful research summary without fabricated citations.';
  if (system.startsWith('You are the Master Agent. Understand')) content = JSON.stringify({ agents: [{ agent: 'research', task: 'Analyze the request carefully.' }] });
  else if (system.startsWith('You are the Master Agent, responsible')) {
    if (failSynthesis && payload.messages[1].content.includes('trigger-provider-failure')) throw new Error('simulated provider connection loss');
    content = 'Here is the **synthesized** answer.';
  }
  return new Response(JSON.stringify({ message: { content } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}/api/conversations${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, data: response.status === 204 ? null : await response.json() };
}

test('conversation CRUD, message persistence, and per-user isolation', async (t) => {
  await connectDatabase();
  await userA.save(); await userB.save();
  const tokenA = jwt.sign({ sub: userA._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1d' });
  const tokenB = jwt.sign({ sub: userB._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1d' });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await Conversation.deleteMany({ user: { $in: [userA._id, userB._id] } });
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    setFetchForTests(undefined);
  });

  assert.equal((await call('')).response.status, 401);
  const created = await call('', { method: 'POST', body: {}, token: tokenA });
  assert.equal(created.response.status, 201);
  const id = created.data.conversation._id;
  const content = 'Show a code sample:\n\n```js\nconsole.log("saved");\n```';
  const sent = await call(`/${id}/messages`, { method: 'POST', body: { content }, token: tokenA });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.data.messages.length, 2);
  assert.equal(sent.data.messages[0].role, 'user');
  assert.equal(sent.data.messages[0].content, content);
  assert.equal(sent.data.messages[1].role, 'assistant');
  assert.equal(sent.data.messages[1].agentName, 'Master Agent · Research Agent');
  assert.deepEqual(sent.data.messages[1].agentNames, ['Master Agent', 'Research Agent']);
  assert.equal(sent.data.messages[1].content, 'Here is the **synthesized** answer.');
  assert.equal(sent.data.messages[1].agentResults[0].agentName, 'Research Agent');

  const followup = await call(`/${id}/messages`, { method: 'POST', body: { content: 'Can you show another example?' }, token: tokenA });
  assert.equal(followup.response.status, 201);
  const followupClassification = providerRequests.findLast((request) => request.messages[0].content.startsWith('You are the Master Agent. Understand'));
  assert.ok(followupClassification.messages[1].content.includes('Show a code sample'));
  assert.ok(followupClassification.messages[1].content.includes('Can you show another example?'));

  const fetched = await call(`/${id}`, { token: tokenA });
  assert.equal(fetched.data.conversation.messages.length, 4);
  assert.equal(fetched.data.conversation.messages[0].content, content);

  failSynthesis = true;
  const providerFailure = await call(`/${id}/messages`, { method: 'POST', body: { content: 'trigger-provider-failure' }, token: tokenA });
  failSynthesis = false;
  assert.equal(providerFailure.response.status, 502);
  assert.equal(providerFailure.data.persistedUserMessage.role, 'user');
  assert.equal(providerFailure.data.persistedUserMessage.content, 'trigger-provider-failure');
  const afterFailure = await call(`/${id}`, { token: tokenA });
  assert.equal(afterFailure.data.conversation.messages.length, 5, 'the user message remains saved when the provider is unavailable');
  const renamed = await call(`/${id}`, { method: 'PATCH', body: { title: 'Saved code example' }, token: tokenA });
  assert.equal(renamed.data.conversation.title, 'Saved code example');

  const deniedFetch = await call(`/${id}`, { token: tokenB });
  assert.equal(deniedFetch.response.status, 404);
  const deniedRename = await call(`/${id}`, { method: 'PATCH', body: { title: 'stolen' }, token: tokenB });
  assert.equal(deniedRename.response.status, 404);
  const listA = await call('', { token: tokenA });
  const listB = await call('', { token: tokenB });
  assert.equal(listA.data.conversations.length, 1);
  assert.equal(listA.data.conversations[0].title, 'Saved code example');
  assert.equal(listB.data.conversations.length, 0);

  const reissuedToken = jwt.sign({ sub: userA._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1d' });
  const persistedAfterSignIn = await call(`/${id}`, { token: reissuedToken });
  assert.equal(persistedAfterSignIn.data.conversation.messages.length, 5);
  assert.equal((await call(`/${id}`, { method: 'DELETE', token: reissuedToken })).response.status, 204);
  assert.equal((await call(`/${id}`, { token: tokenA })).response.status, 404);
});
