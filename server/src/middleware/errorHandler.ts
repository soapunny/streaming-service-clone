import { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  const status = err.status ?? 500;
  // 5xx messages can leak internals (stack details, hostnames), so only log them.
  const message = status < 500 ? err.message : "Internal server error";
  res.status(status).json({ error: message });
};
