export function errorHandler(error, _req, res, _next) {
  const statusCode = error.code === 11000 ? 409 : error.code === 'LIMIT_FILE_SIZE' ? 413 : error.code === 'LIMIT_UNEXPECTED_FILE' ? 400 : (error.statusCode || 500);
  if (error.code === 'EMAIL_DELIVERY_FAILED') {
    console.error(`Email delivery failed: ${error.message}`);
  } else if (statusCode >= 500) console.error(error);
  res.status(statusCode).json({
    status: 'error',
    message: statusCode === 500 ? 'An unexpected server error occurred.' : error.code === 'EMAIL_DELIVERY_FAILED' ? 'Email delivery failed. Please check the SMTP configuration and try again.' : statusCode === 409 ? 'An account with this email already exists.' : error.message,
  });
}
