const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_CHAT_MODEL = 'qwen2.5:7b-instruct-q4_K_M';
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text:latest';

let fetchForTests;

export function setFetchForTests(implementation) {
  fetchForTests = implementation;
}

function getBaseUrl() {
  return (process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');
}

function getChatModel() {
  return process.env.LLM_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

function getEmbeddingModel() {
  return process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

function localError(message, statusCode, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function modelNotFoundError(model, label, cause) {
  return localError(
    `Ollama model "${model}" was not found for ${label}. Run "ollama pull ${model}" and try again.`,
    503,
    'OLLAMA_MODEL_NOT_FOUND',
    cause,
  );
}

function connectionError(error) {
  const details = `${error?.message || ''} ${error?.cause?.code || ''}`.toLowerCase();
  return error?.name === 'TypeError'
    || error?.code === 'ECONNREFUSED'
    || details.includes('fetch failed')
    || details.includes('econnrefused');
}

async function requestOllama(path, payload, { model, label }) {
  const baseUrl = getBaseUrl();
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 60_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (fetchForTests || fetch)(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw localError(`Ollama returned an invalid response while generating ${label}.`, 502, 'OLLAMA_INVALID_RESPONSE', error);
    }

    const providerMessage = typeof data?.error === 'string' ? data.error : '';
    if (!response.ok || providerMessage) {
      if (/model.{0,40}not found|not found.{0,40}model/i.test(providerMessage)) {
        throw modelNotFoundError(model, label, new Error(providerMessage));
      }
      const statusCode = response.status >= 500 ? 503 : 502;
      throw localError(
        `Ollama returned HTTP ${response.status} while generating ${label}${providerMessage ? `: ${providerMessage}` : '.'}`,
        statusCode,
        'OLLAMA_REQUEST_FAILED',
      );
    }
    return data;
  } catch (error) {
    if (error.statusCode) throw error;
    if (controller.signal.aborted || error.name === 'AbortError') {
      throw localError(`Ollama ${label} request timed out after ${timeoutMs} ms.`, 504, 'OLLAMA_TIMEOUT', error);
    }
    if (connectionError(error)) {
      throw localError(
        `Could not connect to Ollama at ${baseUrl}. Start Ollama and make sure it is listening on that address.`,
        503,
        'OLLAMA_UNAVAILABLE',
        error,
      );
    }
    throw localError(`Ollama ${label} request failed: ${error.message || 'unknown error'}`, 502, 'OLLAMA_REQUEST_FAILED', error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateChatCompletion({ system, user, temperature = 0.4, json = false }) {
  const model = getChatModel();
  const payload = {
    model,
    messages: [
      { role: 'system', content: String(system) },
      { role: 'user', content: String(user) },
    ],
    stream: false,
    options: { temperature },
    ...(json ? { format: 'json' } : {}),
  };
  const response = await requestOllama('/api/chat', payload, { model, label: 'chat response' });
  const content = response.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw localError('Ollama returned an empty chat response.', 502, 'OLLAMA_EMPTY_RESPONSE');
  }
  return content.trim();
}

export async function generateEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0 || texts.some((text) => !String(text).trim())) {
    throw new TypeError('Embedding inputs must be a non-empty array of text.');
  }
  const model = getEmbeddingModel();
  const response = await requestOllama('/api/embed', {
    model,
    input: texts.map(String),
  }, { model, label: 'document embedding' });
  const vectors = response.embeddings;
  if (!Array.isArray(vectors) || vectors.length !== texts.length
    || vectors.some((vector) => !Array.isArray(vector) || !vector.length || vector.some((value) => !Number.isFinite(value)))) {
    throw localError('Ollama returned invalid document embedding vectors.', 502, 'OLLAMA_INVALID_EMBEDDINGS');
  }
  if (vectors.some((vector) => vector.length !== vectors[0].length)) {
    throw localError('Ollama returned incompatible document embedding vectors.', 502, 'OLLAMA_INVALID_EMBEDDINGS');
  }
  return vectors;
}
