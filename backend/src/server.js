import './config/env.js';
import app from './app.js';
import { connectDatabase } from './config/database.js';

const port = Number(process.env.PORT) || 5000;
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be configured with at least 32 characters.');
  process.exit(1);
}
try {
  await connectDatabase();
} catch (error) {
  console.error(`MongoDB connection failed: ${error.message}`);
  console.error('The API will start, but /api/health will return 503 until MongoDB connects.');
}

app.listen(port, () => console.info(`Chatbot API listening on http://localhost:${port}`));
