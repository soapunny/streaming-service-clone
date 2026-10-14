import { createClient } from "redis";

// REDIS_URL unset -> default to redis://localhost:6379
export const redis = createClient({
  url: process.env.REDIS_URL,
  // Fail commands right away while disconnected instead of gueuing them,
  // so a Redis outage falls back to TMDB rather than hanging the request.
  disableOfflineQueue: true, //false: wait 5002ms, true: fail immediately and use TMDB instead
});

// Without an "error" listener, a connection error would crash the process.
redis.on("error", (err) =>
  console.error("Redis error:", err.code ?? err.message),
);
