import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import JSZip from 'jszip';
import User from '../src/models/User.js';
import Conversation from '../src/models/Conversation.js';
import Document from '../src/models/Document.js';
import DocumentChunk from '../src/models/DocumentChunk.js';
import { connectDatabase, mongoose } from '../src/config/database.js';
import { setFetchForTests } from '../src/services/llmProvider.js';

process.env.NODE_ENV = 'test';
process.env.LLM_MODEL = 'rag-test-chat-model';
process.env.EMBEDDING_MODEL = 'rag-test-embedding-model';
process.env.RAG_MIN_SIMILARITY = '0.2';
const { default: app } = await import('../src/app.js');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const userA = new User({ name: 'RAG Owner', email: `rag-owner-${suffix}@example.test`, passwordHash: 'test-hash', isVerified: true });
const userB = new User({ name: 'Other RAG Owner', email: `rag-other-${suffix}@example.test`, passwordHash: 'test-hash', isVerified: true });
const tokenA = () => jwt.sign({ sub: userA._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1d' });
const tokenB = () => jwt.sign({ sub: userB._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1d' });
let server;
let baseUrl;
let embeddingRequestCount = 0;
const studyPrompts = [];

function vectorFor(text) {
  const value = text.toLowerCase();
  return ['telescope', 'ocean', 'sourdough', 'invoice', 'secretquartz'].map((term) => value.includes(term) ? 1 : 0);
}

setFetchForTests(async (url, options) => {
  const body = JSON.parse(options.body);
  if (url.endsWith('/api/embed')) {
    embeddingRequestCount += 1;
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return new Response(JSON.stringify({ embeddings: inputs.map((text) => vectorFor(text)) }), { status: 200 });
  }
  const system = body.messages[0].content;
  if (system.startsWith('You are the Master Agent. Understand')) {
    const isDocQuestion = /uploaded document|selected documents?/i.test(body.messages[1].content);
    return new Response(JSON.stringify({ message: { content: JSON.stringify({
      documentQuestion: isDocQuestion,
      agents: [{ agent: 'study', task: 'Answer the question from the provided material.' }],
    }) } }), { status: 200 });
  }
  if (system.startsWith('You are the Study Agent.')) {
    studyPrompts.push(body.messages[1].content);
    return new Response(JSON.stringify({ message: { content: 'The retrieved passage explains how the telescope focuses light.' } }), { status: 200 });
  }
  if (system.startsWith('You are the Master Agent, responsible')) {
    return new Response(JSON.stringify({ message: { content: 'The telescope focuses incoming light with its concave primary mirror.' } }), { status: 200 });
  }
  throw new Error(`Unexpected LLM request: ${system.slice(0, 50)}`);
});

function makePdf(pages) {
  const escapePdf = (value) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((text, index) => {
    const pageId = pageIds[index]; const contentId = pageId + 1;
    const stream = `BT /F1 12 Tf 72 720 Td (${escapePdf(text)}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf);
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

async function makeDocx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs = text.split('\n').map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function api(path, { method = 'GET', token, file, body } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let requestBody = body ? JSON.stringify(body) : undefined;
  if (file) {
    const form = new FormData();
    form.append('file', new Blob([file.buffer], { type: file.type }), file.name);
    requestBody = form;
  } else if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}/api${path}`, { method, headers, body: requestBody });
  return { response, data: response.status === 204 ? null : await response.json() };
}

test('PDF/DOCX upload, deduplication, cosine retrieval, citations, and ownership isolation', async (t) => {
  await connectDatabase();
  await userA.save(); await userB.save();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    const userIds = [userA._id, userB._id];
    await DocumentChunk.deleteMany({ user: { $in: userIds } });
    await Document.deleteMany({ user: { $in: userIds } });
    await Conversation.deleteMany({ user: { $in: userIds } });
    await User.deleteMany({ _id: { $in: userIds } });
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    setFetchForTests(undefined);
  });

  const testFiles = [
    { name: 'Astronomy Handbook.pdf', type: 'application/pdf', buffer: makePdf([`General astronomy notes. ${'Background material for this handbook. '.repeat(12)}`, 'The telescope focuses incoming light with its concave primary mirror.']) },
    { name: 'Ocean Field Notes.pdf', type: 'application/pdf', buffer: makePdf(['Coral reefs support marine biodiversity and protect coastlines from waves.']) },
    { name: 'Kitchen Notes.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await makeDocx('Sourdough bread is made with flour, water, salt, and a fermented starter.') },
    { name: 'Invoice Guide.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await makeDocx('Invoice payment is due within thirty days of the invoice date.') },
  ];

  const uploaded = [];
  for (const file of testFiles) {
    const result = await api('/documents', { method: 'POST', token: tokenA(), file });
    assert.equal(result.response.status, 201, `${file.name} uploads and is indexed`);
    assert.equal(result.data.document.status, 'ready');
    assert.ok(result.data.document.chunkCount > 0);
    uploaded.push(result.data.document);
  }
  assert.equal(uploaded.length, 4, 'two PDFs and two DOCX files are processed');
  assert.equal(uploaded[0].pageReferenceType, 'pdf');
  assert.equal(uploaded[2].pageReferenceType, 'estimated');

  const beforeDuplicate = embeddingRequestCount;
  const duplicate = await api('/documents', { method: 'POST', token: tokenA(), file: testFiles[0] });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.data.alreadyProcessed, true);
  assert.equal(embeddingRequestCount, beforeDuplicate, 'the same content is not embedded again');

  const list = await api('/documents', { token: tokenA() });
  assert.equal(list.data.documents.length, 4);
  const pdfView = await api(`/documents/${uploaded[0].id}`, { token: tokenA() });
  assert.ok(pdfView.data.chunks.some((chunk) => chunk.pageNumbers.includes(2)));
  const forbiddenView = await api(`/documents/${uploaded[0].id}`, { token: tokenB() });
  assert.equal(forbiddenView.response.status, 404);
  assert.equal((await api('/documents', { token: tokenB() })).data.documents.length, 0);

  const conversation = await api('/conversations', { method: 'POST', token: tokenA(), body: {} });
  const response = await api(`/conversations/${conversation.data.conversation._id}/messages`, {
    method: 'POST', token: tokenA(), body: { content: 'According to the uploaded document, how does the telescope focus light?' },
  });
  assert.equal(response.response.status, 201);
  const assistant = response.data.messages[1];
  assert.equal(assistant.role, 'assistant');
  assert.ok(assistant.content.includes('telescope'));
  assert.deepEqual(assistant.sources.map((source) => source.documentName), ['Astronomy Handbook.pdf']);
  assert.deepEqual(assistant.sources[0].pageNumbers, [2]);
  assert.deepEqual(assistant.agentNames, ['Master Agent', 'Study Agent']);
  assert.equal(assistant.agentResults[0].agentName, 'Study Agent');

  const studyConversation = await api('/conversations', { method: 'POST', token: tokenA(), body: {} });
  const studyTasks = [
    'Summarize the selected documents into clear study notes.',
    'Generate 10 MCQs from the selected documents with answers.',
    'Create important exam questions from the selected documents.',
    'Make a practice quiz from the selected documents with an answer key.',
  ];
  for (const content of studyTasks) {
    const studyResponse = await api(`/conversations/${studyConversation.data.conversation._id}/messages`, {
      method: 'POST', token: tokenA(), body: { content, documentIds: [uploaded[0].id] },
    });
    assert.equal(studyResponse.response.status, 201);
    assert.equal(studyResponse.data.messages[1].agentNames.at(-1), 'Study Agent', `Study Mode routing failed for: ${content}`);
    assert.equal(studyResponse.data.messages[1].sources[0].documentName, 'Astronomy Handbook.pdf');
  }
  assert.ok(studyPrompts[1].includes('General astronomy notes'));
  assert.ok(studyPrompts[1].includes('concave primary mirror'));
  assert.match(studyPrompts[2], /MCQs/);
  assert.match(studyPrompts[3], /important exam questions/);
  assert.match(studyPrompts[4], /practice quiz/);

  const selectedWrongDoc = await api(`/conversations/${conversation.data.conversation._id}/messages`, {
    method: 'POST', token: tokenA(), body: {
      content: 'According to the uploaded document, how does the telescope focus light?',
      documentIds: [uploaded[1].id],
    },
  });
  assert.match(selectedWrongDoc.data.messages[1].content, /couldn’t find/i, 'RAG uses only the documents selected by the user');

  const absentAnswer = await api(`/conversations/${conversation.data.conversation._id}/messages`, {
    method: 'POST', token: tokenA(), body: { content: 'According to the uploaded document, what is the lunar payroll allowance?', documentIds: [uploaded[0].id] },
  });
  assert.match(absentAnswer.data.messages[1].content, /couldn’t find/i);
  assert.deepEqual(absentAnswer.data.messages[1].sources, []);

  const privateFile = { name: 'Secret Manual.pdf', type: 'application/pdf', buffer: makePdf(['The secretquartz maintenance schedule is every 47 days.']) };
  const deniedUpload = await api('/documents', { method: 'POST', token: tokenB(), file: privateFile });
  assert.equal(deniedUpload.response.status, 201);
  assert.notEqual(deniedUpload.data.document.id, uploaded[0].id);
  assert.equal((await api('/documents', { token: tokenB() })).data.documents.length, 1);
  const isolatedQuery = 'According to the uploaded document, what is the secretquartz maintenance schedule?';
  const userAResult = await api(`/conversations/${conversation.data.conversation._id}/messages`, { method: 'POST', token: tokenA(), body: { content: isolatedQuery } });
  assert.match(userAResult.data.messages[1].content, /couldn’t find/i, 'another account’s document is not included in retrieval');
  const userBConversation = await api('/conversations', { method: 'POST', token: tokenB(), body: {} });
  const userBResult = await api(`/conversations/${userBConversation.data.conversation._id}/messages`, { method: 'POST', token: tokenB(), body: { content: isolatedQuery } });
  assert.deepEqual(userBResult.data.messages[1].sources.map((source) => source.documentName), ['Secret Manual.pdf']);
  const removed = await api(`/documents/${uploaded[1].id}`, { method: 'DELETE', token: tokenA() });
  assert.equal(removed.response.status, 204);
  assert.equal((await api(`/documents/${uploaded[1].id}`, { token: tokenA() })).response.status, 404);
});
