import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runMasterAgent } from '../src/agents/masterAgent.js';
import { setFetchForTests } from '../src/services/llmProvider.js';

process.env.LLM_MODEL = 'agent-routing-test-model';

function routeFromRequest(prompt) {
  const userRequest = prompt.split('<user_request>')[1]?.split('</user_request>')[0] || prompt;
  const text = userRequest.toLowerCase();
  const agents = [];
  if (/study|concept|mcq|exam prep|learning|study guide/.test(text)) agents.push('study');
  if (/research|evidence|sources|compare/.test(text)) agents.push('research');
  if (/code|coding|debug|javascript|program|quiz app/.test(text)) agents.push('coding');
  if (!agents.length) agents.push('general');
  return agents.slice(0, 3).map((agent) => ({ agent, task: userRequest.trim() }));
}

function mockProvider(router) {
  const calls = [];
  setFetchForTests(async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, headers: options.headers, body });
    const system = body.messages[0].content;
    const query = body.messages[1].content;
    let content;
    if (system.startsWith('You are the Master Agent. Understand')) {
      content = JSON.stringify({ agents: router(query) });
    } else if (system.startsWith('You are the Master Agent, responsible')) {
      content = 'The combined answer addresses the request.';
    } else if (system.startsWith('You are the Study Agent.')) {
      content = 'Study notes and an example.';
    } else if (system.startsWith('You are the Research Agent.')) {
      content = 'Analysis with uncertainty stated and no invented sources.';
    } else if (system.startsWith('You are the Coding Agent.')) {
      content = '```js\nconst ready = true;\n```';
    } else if (system.startsWith('You are the General Agent.')) {
      content = 'A clear everyday answer.';
    } else {
      throw new Error('Unexpected agent system instruction.');
    }
    return new Response(JSON.stringify({ message: { content } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

test('Master Agent routes to every specialist and synthesizes a single answer', async (t) => {
  t.after(() => setFetchForTests(undefined));
  const cases = [
    ['study', 'Explain this concept and create exam MCQs.'],
    ['research', 'Research this topic and compare the available evidence.'],
    ['coding', 'Debug this JavaScript error and show a fix.'],
    ['general', 'What is a good way to start the day?'],
  ];

  for (const [agent, query] of cases) {
    const calls = mockProvider(routeFromRequest);
    const result = await runMasterAgent(query);
    assert.deepEqual(result.agentNames, ['Master Agent', `${agent[0].toUpperCase()}${agent.slice(1)} Agent`]);
    assert.equal(result.content, 'The combined answer addresses the request.');
    assert.equal(result.agentResults[0].agentName, result.agentNames[1]);
    assert.ok(result.agentResults[0].content.length > 0);
    assert.equal(calls.length, 3, 'classifier, selected specialist, and synthesis are all called');
    assert.ok(calls.every((call) => call.url.endsWith('/api/chat')));
    assert.ok(calls.every((call) => !('Authorization' in call.headers)));
    assert.equal(calls[0].body.format, 'json');
    assert.equal(calls[0].body.stream, false);
    assert.ok(calls[0].body.messages[1].content.includes(query));
    assert.ok(calls.some((call) => call.body.messages[0].content.startsWith(`You are the ${result.agentNames[1]}.`)));
  }

  const query = 'Create an exam prep guide and write a small quiz app.';
  const calls = mockProvider(routeFromRequest);
  const combined = await runMasterAgent(query);
  assert.deepEqual(combined.agentNames, ['Master Agent', 'Study Agent', 'Coding Agent']);
  assert.deepEqual(combined.agentResults.map((item) => item.agentName), ['Study Agent', 'Coding Agent']);
  assert.equal(calls.length, 4, 'complex requests run both specialists plus classification and synthesis');
  assert.equal(combined.content, 'The combined answer addresses the request.');
});
