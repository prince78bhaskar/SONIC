# SONIC Multi-Agent Workspace

React, Express, and MongoDB chatbot with account authentication, user-owned conversations and documents, multi-agent orchestration, and retrieval-augmented generation (RAG).

## Requirements

- Node.js 20 or newer
- MongoDB running locally or a MongoDB connection URI
- SMTP account credentials for signup and password-reset email
- Ollama installed locally with a chat model and embedding model available

## Quick start (PowerShell)

From the project root:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm install
npm install --prefix backend
npm install --prefix frontend
```

Edit `backend/.env` and set your MongoDB URI, random JWT and OTP secrets (32+ characters), SMTP account/app password, and `LLM_MODEL`. For Gmail SMTP, use a Google app password for `SMTP_PASS`. Chat and embeddings use Ollama at `http://localhost:11434`; no LLM API key or paid model service is needed. The default embedding model is `nomic-embed-text:latest`. Keep `.env` files private; Git ignores them.

Start MongoDB, then start both app servers:

```powershell
npm run dev
```

Open the frontend at http://localhost:5173. The Express API listens on http://localhost:5000. The health endpoint is `GET /api/health` and reports MongoDB connection status.

Useful commands:

```powershell
npm run build                 # production frontend build
npm test --prefix backend     # backend integration suite
npm start                     # production backend process
npm run reindex:documents --prefix backend # refresh stored vectors after changing embedding models
```

For deployments, configure the same environment values in the hosting environment. Set `VITE_API_URL` in `frontend/.env` when the API is not at `http://localhost:5000/api`.

## Environment variables

| Variable | Purpose | Default / requirement |
| --- | --- | --- |
| `PORT` | Express port | `5000` |
| `MONGODB_URI` | MongoDB connection | Local development URI if omitted |
| `CLIENT_ORIGIN` | Allowed browser origin for CORS | `http://localhost:5173` |
| `JWT_SECRET` | Signs login tokens | Required; use a random secret of 32+ characters |
| `JWT_EXPIRES_IN` | Token lifetime | `1d` |
| `OTP_SECRET` | HMAC key for stored OTP digests | Separate random secret of 32+ characters |
| `OTP_RESEND_COOLDOWN_SECONDS` | Per-account OTP resend cooldown | `60` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | SMTP server settings | Host required to send mail; port `587`, secure `false` |
| `SMTP_USER`, `SMTP_PASS` | SMTP credentials | Required for email verification and reset mail |
| `EMAIL_FROM` | Sender label/address | Defaults to `SMTP_USER` (`MAIL_FROM` remains supported for existing deployments) |
| `OLLAMA_BASE_URL` | Local Ollama HTTP API | `http://localhost:11434` |
| `LLM_MODEL` | Chat completion model | Required for chat replies and document indexing |
| `LLM_TIMEOUT_MS` | Provider request timeout | `60000` |
| `EMBEDDING_MODEL` | Local Ollama embedding model | `nomic-embed-text:latest` |
| `RAG_MIN_SIMILARITY` | Cosine similarity cutoff | `0.22` |
| `VITE_API_URL` | Frontend API base URL | `http://localhost:5000/api` |

The backend starts without SMTP or Ollama. Email routes report a configuration error until SMTP is configured; chat and document indexing report a clear Ollama connection or missing-model error until Ollama is available. The backend tests replace email and Ollama HTTP calls, so they do not send mail or contact external LLM services.

## Features and API

- **Authentication:** signup, six-digit email verification, resend cooldown/rate limits, login, forgot/reset password, bcrypt password hashes, and bearer JWT authentication. Private routes use `Authorization: Bearer <token>`.
- **Conversations:** list, create, read, rename, delete, and send messages under `/api/conversations`. Recent turns are included in agent prompts. Conversation queries are always scoped to the authenticated user.
- **Agents:** the backend Master Agent routes to Study, Research, Coding, and General specialists; it can run several specialists in parallel and synthesize one answer. Individual specialist results and agent labels are saved with the response. Instructions are in `backend/src/agents/instructions/`.
- **Smart Study Mode:** creates summaries, multiple-choice questions, important questions, and practice quizzes from selected documents.
- **Documents/RAG:** authenticated `GET/POST/DELETE /api/documents` plus `GET /api/documents/:id`. PDF and DOCX text is chunked, embedded by Ollama, stored in MongoDB, and retrieved with cosine similarity. Retrieval filters by both user and selected document IDs. Answers cite source document names and page references; when relevant evidence is absent the assistant says it could not find the answer.
- **Frontend:** responsive chat, conversation and document sidebars, document selection/view/delete, Markdown and code formatting, agent collaboration details, loading/error states, and source-reference links.

Uploaded binary files are not retained; extracted chunks and embeddings are stored. After changing `EMBEDDING_MODEL`, run `npm run reindex:documents --prefix backend` to regenerate vectors from the saved chunk text without deleting documents or conversation history. PDF page numbers are exact. DOCX page references are estimates because rendered pagination depends on the word processor. PDFs without selectable text (for example, image scans) are rejected; OCR is not configured.

## Testing

Run:

```powershell
npm test --prefix backend
npm run build
npm audit --prefix backend --omit=dev
```

The integration suite uses the local MongoDB and covers signup/OTP/login, JWT protection, all specialist routes and multi-agent synthesis, conversation context and persistence, user isolation, duplicate upload handling, two PDF and two DOCX extractions, page citations, selected-document retrieval, and no-answer behavior. Ollama HTTP responses and embeddings are mocked in the suite; make separate live requests to the configured local models to verify generation quality and embedding availability.

## Project layout

```text
frontend/  React app, authentication, chat UI, Markdown, and document controls
backend/   Express API, auth, agents, document extraction, embeddings, RAG, and MongoDB models
```
"# SONIC" 
