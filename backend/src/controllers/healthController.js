import { mongoose } from '../config/database.js';

export function getHealth(_req, res) {
  const database = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const healthy = database === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'unavailable',
    service: 'chatbot-api',
    database,
    timestamp: new Date().toISOString(),
  });
}
