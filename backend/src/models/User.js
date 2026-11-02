import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  isVerified: { type: Boolean, default: false },
  emailOtpHash: { type: String, select: false },
  emailOtpExpiresAt: Date,
  emailOtpSentAt: Date,
  emailOtpAttempts: { type: Number, default: 0 },
  passwordResetOtpHash: { type: String, select: false },
  passwordResetOtpExpiresAt: Date,
  passwordResetOtpSentAt: Date,
  passwordResetOtpAttempts: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('User', userSchema);
