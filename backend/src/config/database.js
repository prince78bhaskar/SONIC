import mongoose from 'mongoose';

export async function connectDatabase(
  uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/multi_agent_chatbot',
) {
  mongoose.connection.on('connected', () => console.info('MongoDB connected.'));
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected.'));
  await mongoose.connect(uri);
  return mongoose.connection;
}

export { mongoose };
