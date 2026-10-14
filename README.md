# Streaming Service Clone

**English** | [한국어](#한국어)

A streaming service clone built on the TMDB API.
So far, only the **Express server skeleton** is in place. This README doubles as a set of **review notes** written while going back over the code line by line.

## Tech Stack

| Area | Technologies |
|---|---|
| Server | Node.js, Express 5, TypeScript, Redis (node-redis) |
| Client | React 19, Vite, React Router, Zustand |
| External API | TMDB |

## Getting Started

```bash
# Server
cd server
cp .env.example .env   # fill in TMDB_API_KEY
npm install
npm run dev            # http://localhost:4000

# Client
cd client
npm install
npm run dev            # http://localhost:5173
```

The server starts even without Redis. In that case it calls TMDB directly, without caching.

## Project Structure

```
server/src
├── index.ts                   # app setup, middleware, routes, startup/shutdown
├── middleware/errorHandler.ts # shared error responses
└── services/redis.ts          # Redis client
```

---

## 📚 Review Notes

### 1. Request Processing Order

Express runs `app.use` / `app.get` **top to bottom, in the order they were registered**.

```
request → cors → response timer → /health? → /api? ─┬─ handled → response
                                                   ├─ error while handling → errorHandler
                                                   └─ no match → 404 handler
```

- The 404 handler and `errorHandler` sit **at the bottom** so they only receive requests no route handled, and errors thrown above them.
- A middleware must call `next()` to pass control on. Otherwise the request stops right there.

### 2. CORS

```ts
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",");
app.use(cors({ origin: CORS_ORIGINS }));
```

- By default, browsers don't hand cross-origin responses to JS, so the server has to declare which origins are allowed.
- ❗ **The server does not block the request.** `cors()` only decides whether to attach the allow headers, and it always calls `next()`. The **browser** is what does the blocking. That's why CORS doesn't apply to curl or Postman.
- `cors()` answers preflight (OPTIONS) requests itself with a 204 and ends there, so they never reach the middleware below (the response time log).
- `??` uses the right-hand value only when the left is `null` or `undefined`.

### 3. Response Time Middleware

```ts
app.use((req, res, next) => {
  const start = performance.now();
  res.on("finish", () => { /* log elapsed time */ });
  next();
});
```

- Records the start time when a request arrives and computes the elapsed time on the `finish` event, when the response has been sent.
- `finish` fires when the server hands the response to the OS. **Network round-trip time is not included**, which makes it handy for comparing server processing time with and without the Redis cache.

### 4. `/health` Health Check

```ts
app.get("/health", (_req, res) => {
  res.json({ status: "ok", redis: redis.isReady ? "up" : "down" });
});
```

- It checks **whether the server process is alive, not whether Redis is up**. The Redis status is just extra information.
- A load balancer (e.g. AWS ALB) calls it periodically and keeps or drops an instance **based only on whether it gets a 200**.
- It always returns 200 because the server still works through TMDB when Redis is down. A Redis outage shouldn't take down healthy servers.
- This isn't an AWS-specific feature. It's a common convention, also used by Docker `HEALTHCHECK`, Kubernetes probes, and uptime monitors.
- A leading `_`, as in `_req`, is a convention meaning "unused parameter".

### 5. `res.status().json()`

```ts
res.status(404).json({ error: "Not found" });
```

- `status()` only sets the status code. `json()` converts the object to JSON and **actually sends the response**.
- `status()` returns `res` itself, so the calls can be chained (method chaining, the same idea as Java's builder pattern).
- Without `status()`, the default is 200.
- A response can only be sent once. Sending twice throws `Cannot set headers after they are sent`.

### 6. errorHandler

```ts
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  const status = err.status ?? 500;
  const message = status < 500 ? err.message : "Internal server error";
  res.status(status).json({ error: message });
};
```

- **4xx** (client errors): the error message is sent as is.
- **5xx** (server errors): only `"Internal server error"` is sent, so internals like stack traces or hostnames don't leak. The details go to the server log through `console.error`.
- Unexpected errors with no `status` are treated as 500.

**❗ `: ErrorRequestHandler` is not inheritance.**

| | Java inheritance (`extends`) | TS function type annotation |
|---|---|---|
| Inherited implementation | Yes | None (only the shape has to match) |
| Exists at runtime | Yes (`instanceof` works) | Erased after compilation |
| Matched by | Declared name | Structure (shape) |

The closest Java analogy is **assigning a lambda to a functional interface**, like `Comparator<String> c = (a, b) -> ...`.

**❗ Don't remove `_next` even though it's unused.** Express decides whether a function is an error handler at runtime by **counting its parameters (4)**, not by its type.

### 7. Connecting to Redis Without `await`

```ts
redis
  .connect()
  .then(() => console.log("Redis connected"))
  .catch((err) => console.error("Redis connect failed:", err.message));

const server = app.listen(PORT, ...);
```

- Because there's no `await`, the **server starts immediately** without waiting for Redis.
- The `.catch` is required. Since Node 15, an unhandled promise rejection **terminates the process**.
- `redis.on("error", ...)` handles disconnects **after** the connection is established. Without this listener, a connection error would crash the process.
- `disableOfflineQueue: true` makes commands fail right away while disconnected instead of being queued, so requests fall back to TMDB instead of hanging.

**Required and optional dependencies are handled differently.**

| | When missing | Why |
|---|---|---|
| `TMDB_API_KEY` | Exit immediately (`process.exit(1)`, fail fast) | Every request would fail without it |
| Redis | Start the server anyway | It's only a cache, so the app still works |

### 8. Graceful Shutdown

```ts
process.on("SIGTERM", () => {
  server.close(() => {
    redis.quit().catch(() => {}).finally(() => process.exit(0));
  });
});
```

- This code doesn't send SIGTERM. It's the termination signal **sent by the platform** (ECS deploys or scale-in, `docker stop`, Kubernetes).
- ❗ The order is **server first, then Redis**, because in-flight requests may still be using Redis.
  1. `server.close`: stop accepting new requests and wait for in-flight ones to finish
  2. `redis.quit`: close the Redis connection (failures are ignored)
  3. `process.exit(0)`: exit normally
- If the process doesn't exit within a grace period, the platform force-kills it with SIGKILL.

---

## 📝 TODO

- [ ] Wire up the `/api` routes: when uncommenting, use `"/api"`, not `"api"`
- [ ] Make the names match: `CORS_ORIGIN` in `.env.example` vs `CORS_ORIGINS` in the code
- [ ] Decide how to load `.env` (`dotenv` is installed but not imported yet)
- [ ] `.trim()` each entry after splitting `CORS_ORIGINS` (in case of spaces after commas)

---

<a id="한국어"></a>

# Streaming Service Clone (한국어)

[English](#streaming-service-clone) | **한국어**

TMDB API를 이용한 스트리밍 서비스 클론 프로젝트입니다.
지금은 **Express 서버의 기본 골격**까지 만들었고, 이 README는 코드를 한 줄씩 다시 보면서 **복습한 내용을 정리한 노트**입니다.

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| Server | Node.js, Express 5, TypeScript, Redis(node-redis) |
| Client | React 19, Vite, React Router, Zustand |
| 외부 API | TMDB |

## 실행 방법

```bash
# 서버
cd server
cp .env.example .env   # TMDB_API_KEY 입력
npm install
npm run dev            # http://localhost:4000

# 클라이언트
cd client
npm install
npm run dev            # http://localhost:5173
```

Redis는 없어도 서버가 실행됩니다. 이 경우 캐시 없이 TMDB를 직접 호출합니다.

## 폴더 구조

```
server/src
├── index.ts                  # 앱 설정, 미들웨어, 라우트, 서버 시작/종료
├── middleware/errorHandler.ts # 공통 에러 응답
└── services/redis.ts         # Redis 클라이언트
```

---

## 📚 복습 노트

### 1. 요청이 처리되는 순서

Express는 `app.use` / `app.get`을 **등록한 순서대로 위에서 아래로** 실행합니다.

```
요청 → cors → 응답시간 측정 → /health? → /api? ─┬─ 정상 처리 → 응답
                                              ├─ 처리 중 에러 → errorHandler
                                              └─ 매칭 안 됨 → 404 핸들러
```

- 404 핸들러와 `errorHandler`가 **맨 아래**에 있는 이유: 위의 라우트가 하나도 처리하지 않은 요청, 위에서 발생한 에러만 받기 위해서입니다.
- `next()`를 호출해야 다음 미들웨어로 넘어갑니다. 호출하지 않으면 요청이 그 자리에서 멈춥니다.

### 2. CORS

```ts
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",");
app.use(cors({ origin: CORS_ORIGINS }));
```

- 브라우저는 다른 출처(origin)로 보내는 요청의 응답을 기본적으로 JS에 넘겨주지 않습니다. 그래서 서버가 허용할 출처를 알려줘야 합니다.
- ❗ **서버가 요청을 막는 게 아닙니다.** `cors()`는 허용 헤더를 붙일지 말지만 정하고 항상 `next()`를 호출합니다. 실제로 막는 건 **브라우저**입니다. 그래서 curl이나 Postman에는 CORS가 적용되지 않습니다.
- Preflight(OPTIONS) 요청은 `cors()`가 직접 204로 응답하고 끝내기 때문에, 그 아래 미들웨어(응답시간 로그)까지 가지 않습니다.
- `??`는 왼쪽 값이 `null`이나 `undefined`일 때만 오른쪽 값을 사용합니다.

### 3. 응답 시간 측정 미들웨어

```ts
app.use((req, res, next) => {
  const start = performance.now();
  res.on("finish", () => { /* 걸린 시간 로그 */ });
  next();
});
```

- 요청이 들어올 때 시작 시각을 기록하고, 응답 전송이 끝나는 `finish` 이벤트에서 걸린 시간을 계산합니다.
- `finish`는 서버가 응답을 OS에 넘긴 시점입니다. **네트워크 왕복 시간은 포함되지 않습니다.** 그래서 Redis 캐시 유무에 따른 서버 처리 속도를 비교하기 좋습니다.

### 4. `/health` 헬스 체크

```ts
app.get("/health", (_req, res) => {
  res.json({ status: "ok", redis: redis.isReady ? "up" : "down" });
});
```

- **Redis 확인용이 아니라 서버 프로세스 생존 확인용**입니다. Redis 상태는 참고 정보로 같이 보여줄 뿐입니다.
- 로드밸런서(AWS ALB 등)는 주기적으로 이 주소를 호출하고, **상태 코드 200 여부만 보고** 인스턴스를 살리거나 내립니다.
- Redis가 죽어도 TMDB로 동작하므로 항상 200을 반환합니다. Redis 장애 때문에 멀쩡한 서버가 내려가면 안 되기 때문입니다.
- AWS 전용 기능이 아니라 일반적인 관례입니다. Docker `HEALTHCHECK`, Kubernetes probe, 모니터링 서비스도 같은 방식으로 사용합니다.
- `_req`처럼 앞에 붙인 `_`는 "사용하지 않는 매개변수"라는 관례 표시입니다.

### 5. `res.status().json()`

```ts
res.status(404).json({ error: "Not found" });
```

- `status()`는 상태 코드만 설정하고, `json()`이 객체를 JSON으로 바꿔 **실제로 응답을 보냅니다.**
- `status()`가 `res` 자신을 반환하기 때문에 점으로 이어 쓸 수 있습니다(메서드 체이닝, 자바의 빌더 패턴과 같은 방식).
- `status()`를 생략하면 기본값은 200입니다.
- 응답은 한 번만 보낼 수 있습니다. 두 번 보내면 `Cannot set headers after they are sent` 에러가 납니다.

### 6. errorHandler

```ts
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  const status = err.status ?? 500;
  const message = status < 500 ? err.message : "Internal server error";
  res.status(status).json({ error: message });
};
```

- **4xx**(클라이언트 잘못)는 에러 메시지를 그대로 보냅니다.
- **5xx**(서버 잘못)는 스택이나 호스트명 같은 내부 정보가 새지 않도록 `"Internal server error"`만 보냅니다. 상세 내용은 `console.error`로 서버 로그에만 남깁니다.
- `status`가 없는 예상 못 한 에러는 500으로 처리됩니다.

**❗ `: ErrorRequestHandler`는 상속이 아닙니다.**

| | 자바 상속(`extends`) | TS 함수 타입 표기 |
|---|---|---|
| 물려받는 구현 | 있음 | 없음 (모양만 맞춤) |
| 런타임에 남는지 | 남음 (`instanceof` 가능) | 컴파일 후 사라짐 |
| 판단 기준 | 선언한 이름 | 구조(모양) |

자바로 비유하면 `Comparator<String> c = (a, b) -> ...`처럼 **함수형 인터페이스에 람다를 넣는 것**에 가깝습니다.

**❗ `_next`를 쓰지 않아도 지우면 안 됩니다.** Express는 타입이 아니라 런타임에 **매개변수 개수(4개)** 를 세서 에러 핸들러인지 판단합니다.

### 7. Redis 연결: `await` 하지 않는 이유

```ts
redis
  .connect()
  .then(() => console.log("Redis connected"))
  .catch((err) => console.error("Redis connect failed:", err.message));

const server = app.listen(PORT, ...);
```

- `await`를 쓰지 않았기 때문에 Redis 연결을 기다리지 않고 **서버가 바로 시작**됩니다.
- `.catch`가 꼭 필요합니다. Node 15부터는 처리되지 않은 Promise 실패(unhandled rejection)가 있으면 **프로세스가 종료**됩니다.
- `redis.on("error", ...)`는 연결된 **이후에** 끊기는 경우를 처리합니다. 이 리스너가 없으면 연결 에러로 프로세스가 죽습니다.
- `disableOfflineQueue: true`로 설정해서, 연결이 끊긴 동안 명령을 쌓아두지 않고 바로 실패시킵니다. 그래야 요청이 멈추지 않고 TMDB로 넘어갑니다.

**필수 의존성과 선택 의존성을 다르게 다룹니다.**

| | 없을 때 | 이유 |
|---|---|---|
| `TMDB_API_KEY` | 바로 종료 (`process.exit(1)`, fail fast) | 없으면 모든 요청이 실패함 |
| Redis | 그대로 서버 시작 | 캐시일 뿐이라 없어도 동작함 |

### 8. Graceful Shutdown

```ts
process.on("SIGTERM", () => {
  server.close(() => {
    redis.quit().catch(() => {}).finally(() => process.exit(0));
  });
});
```

- SIGTERM은 이 코드가 보내는 게 아니라, **플랫폼(ECS 배포·scale-in, `docker stop`, Kubernetes)이 보내는 종료 신호**입니다.
- ❗ 순서는 **서버를 먼저 닫고 → Redis를 닫습니다.** 처리 중인 요청이 아직 Redis를 쓰고 있을 수 있기 때문입니다.
  1. `server.close`: 새 요청은 받지 않고, 처리 중인 요청이 끝날 때까지 기다림
  2. `redis.quit`: Redis 연결 종료 (실패해도 무시)
  3. `process.exit(0)`: 정상 종료
- 플랫폼은 일정 시간 안에 종료되지 않으면 SIGKILL로 강제 종료합니다.

---

## 📝 TODO

- [ ] `/api` 라우트 연결: 주석을 풀 때 `"api"`가 아니라 `"/api"`로 작성하기
- [ ] `.env.example`의 `CORS_ORIGIN`과 코드의 `CORS_ORIGINS` 이름 맞추기
- [ ] `.env` 파일 로드 방식 정하기 (`dotenv`는 설치돼 있지만 아직 import하지 않음)
- [ ] `CORS_ORIGINS`를 나눈 뒤 `.trim()` 처리하기 (쉼표 뒤 공백 대비)
