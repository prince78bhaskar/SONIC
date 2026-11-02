import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    if (!token) return res.status(401).json({ status: 'error', message: 'Authentication required.' });
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(claims.sub).select('name email isVerified');
    if (!user || !user.isVerified) return res.status(401).json({ status: 'error', message: 'Invalid or expired session.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired session.' });
  }
}
