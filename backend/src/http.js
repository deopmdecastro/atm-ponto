export function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra) err.extra = extra;
  return err;
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

