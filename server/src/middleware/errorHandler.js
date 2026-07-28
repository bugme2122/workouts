// Last middleware in the chain. Formats everything thrown or passed to next(err) as
// `{ error: <message> }` with the right status code.
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  let status = err.status || 500;
  let message = err.message || 'Request failed.';

  // A malformed ObjectId (or other Mongoose cast) is a client error, not a server fault.
  if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier.';
  }
  // Mongoose schema validation is a client error too.
  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors || {})[0]?.message || 'Validation failed.';
  }

  if (status === 500) {
    console.error('[error]', err);
    message = 'Something went wrong.';
  }
  res.status(status).json({ error: message });
}
