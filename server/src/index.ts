import express from "express";
import cors from "cors";
import { redis } from "./services/redis";
import { errorHandler } from "./middleware/errorHandler";

// Fail fast: without the key every TMDB call would 401, so don't start at all.
if (!process.env.TMDB_API_KEY) {
  console.error("TMDB_API_KEY is not set");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT ?? 4000;
// Comma-separated list, e.g. "https://xxxx.cloudfront.net, http://localhost:5173"
const CORS_ORIGINS = (
  process.env.CORS_ORIGINS ?? "http://localhost:5173"
).split(",");

app.use(cors({ origin: CORS_ORIGINS })); //allow frontend server to access backend

// Server-side response time, so latency can be measured without network round trip.
app.use((req, res, next) => {
  const start = performance.now();
  res.on("finish", () => {
    //finish event is emitted when the response has been sent to OS
    const ms = (performance.now() - start).toFixed(1);
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Always 200 while the process is up: Redis is optional (TMDB fallback),
// so a Redis outage shouldn't make the load balancer kill healthy instances.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", redis: redis.isReady ? "up" : "down" });
});

// app.use("/api", movieRoutes);
// app.use("/api", searchRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);

// Don't await: the server should start even if Redis is down.
redis
  .connect()
  .then(() => console.log("Redis connected"))
  .catch((err) => console.error("Redis connect failed:", err.message)); // without the catch, a connection error would crash the process.

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Graceful shutdown: on deploy/scale-in the platform sends SIGTERM.
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  server.close(() => {
    // 1)Server stops taking new requests, 2)let in-flight ones finish, 3)close itself, 4)then close Redis.
    redis
      .quit()
      .catch(() => {})
      .finally(() => process.exit(0)); //0: success, 1: failure
  });
});
