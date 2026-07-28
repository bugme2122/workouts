// Small helper for throwing errors the errorHandler can turn into `{ error }` responses.
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
