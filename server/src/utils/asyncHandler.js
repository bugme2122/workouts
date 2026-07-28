// Wrap an async route handler so thrown errors / rejected promises reach the errorHandler.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
