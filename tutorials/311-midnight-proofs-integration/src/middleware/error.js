const config = require('../config/midnight');

class AppError extends Error {
  constructor(message, statusCode, type, retryable = false) {
    super(message);
    this.statusCode = statusCode;
    this.type = type;
    this.retryable = retryable;
    this.timestamp = Date.now();
  }
}

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let type = err.type || 'UNKNOWN_ERROR';
  let retryable = err.retryable || false;

  // Log error in development
  if (config.server.nodeEnv === 'development') {
    console.error('Error:', {
      message,
      type,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
  }

  // Don't leak error details in production
  if (config.server.nodeEnv === 'production') {
    if (statusCode === 500) {
      message = 'Something went wrong';
    }
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      type,
      retryable,
      timestamp: err.timestamp || Date.now(),
    },
  });
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const notFound = (req, res, next) => {
  const error = new AppError(
    `Route ${req.originalUrl} not found`,
    404,
    'ROUTE_NOT_FOUND',
    false
  );
  next(error);
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFound,
  AppError,
};
