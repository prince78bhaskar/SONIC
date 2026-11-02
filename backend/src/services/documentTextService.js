const ESTIMATED_DOCX_PAGE_CHARACTERS = 2600;
const CHUNK_TARGET_CHARACTERS = 1400;
const CHUNK_OVERLAP_CHARACTERS = 220;

export async function extractDocumentPages(file) {
  if (file.mimeType === 'application/pdf') return extractPdfPages(file.buffer);
  if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammothModule = await import('mammoth');
    const mammoth = mammothModule.default || mammothModule;
    const extracted = await mammoth.extractRawText({ buffer: file.buffer });
    const text = normalizeText(extracted.value);
    if (!text) throw invalidDocument('No readable text was found in this DOCX file.');
    return splitDocxIntoEstimatedPages(text);
  }
  throw invalidDocument('Only PDF and DOCX documents are supported.');
}

async function extractPdfPages(buffer) {
  let pdf;
  let loadingTask;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true });
    pdf = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizeText(content.items.map((item) => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join(' '));
      if (text) pages.push({ pageNumber, text });
    }
    if (!pages.length) throw invalidDocument('No selectable text was found in this PDF. Scanned image PDFs need OCR before upload.');
    return { pages, pageCount: pdf.numPages, pageReferenceType: 'pdf' };
  } catch (error) {
    if (error.statusCode) throw error;
    throw invalidDocument(`Could not read this PDF: ${error.message}`);
  } finally {
    await loadingTask?.destroy();
  }
}

function splitDocxIntoEstimatedPages(text) {
  const pages = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + ESTIMATED_DOCX_PAGE_CHARACTERS, text.length);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      const sentenceBreak = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('? ', end), text.lastIndexOf('! ', end));
      const preferred = Math.max(paragraphBreak, sentenceBreak);
      if (preferred > cursor + ESTIMATED_DOCX_PAGE_CHARACTERS * 0.6) end = preferred + (preferred === paragraphBreak ? 2 : 1);
    }
    const pageText = text.slice(cursor, end).trim();
    if (pageText) pages.push({ pageNumber: pages.length + 1, text: pageText });
    cursor = end;
  }
  return { pages, pageCount: pages.length, pageReferenceType: 'estimated' };
}

export function chunkDocumentPages(pages, pageReferenceType) {
  const chunks = [];
  for (const page of pages) {
    const pageText = normalizeText(page.text);
    let start = 0;
    while (start < pageText.length) {
      let end = Math.min(start + CHUNK_TARGET_CHARACTERS, pageText.length);
      if (end < pageText.length) {
        const paragraphBreak = pageText.lastIndexOf('\n\n', end);
        const sentenceBreak = Math.max(pageText.lastIndexOf('. ', end), pageText.lastIndexOf('? ', end), pageText.lastIndexOf('! ', end));
        const preferred = Math.max(paragraphBreak, sentenceBreak);
        if (preferred > start + CHUNK_TARGET_CHARACTERS * 0.6) end = preferred + (preferred === paragraphBreak ? 2 : 1);
      }
      const content = pageText.slice(start, end).trim();
      if (content) chunks.push({ text: content, pageNumbers: [page.pageNumber], pageReferenceType });
      if (end >= pageText.length) break;
      start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARACTERS);
      while (start < end && /\s/.test(pageText[start])) start += 1;
    }
  }
  if (!chunks.length) throw invalidDocument('No readable text was found in this document.');
  return chunks;
}

function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').replace(/[\t\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function invalidDocument(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}
