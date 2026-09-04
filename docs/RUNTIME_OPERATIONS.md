# Runtime Operations — Build / Restart / Verify

Design references: `OH-42`, `OH-61`, `OH-66`, `OH-67`, `OH-P1`.

## Why this exists

`dist/` is a generated build directory and is intentionally ignored by Git. The production Runtime executes compiled JavaScript from `dist/`.

A `git pull` changes `src/` but does **not** update an existing local `dist/`. Starting an old `dist/index.js` after pulling new source can therefore expose routes/auth behavior from an older commit.

This previously presented as two apparently unrelated regressions:

- source contained `GET /v1/phone/status`, but the running Runtime returned `404`;
- source allowed `OUR_HOME_INGEST_TOKEN` for protected phone ingest, but the running Runtime only accepted a device token.

Treat source/runtime build identity as one deployment invariant.

## Safe production start

Use the repository scripts, not `node dist/index.js` directly:

```bash
npm ci
npm run start:http
```

`start:http` rebuilds the current TypeScript source before launching the compiled Runtime.

The same rule applies to the worker:

```bash
npm run worker
```

## Updating an existing deployment

```text
git fetch / checkout intended commit
→ npm ci
→ build current source
→ restart Runtime service
→ verify endpoints
```

If a service manager is used, its `ExecStart`/start command should invoke the repository script or its deploy step must run `npm run build` immediately before restart.

Do not use this after a source update without rebuilding:

```bash
node dist/index.js
```

## Required environment names

Secrets remain in the runtime environment and must never be committed:

- `OUR_HOME_MCP_TRANSPORT=http`
- `OUR_HOME_MCP_HOST`
- `OUR_HOME_MCP_PORT`
- `OUR_HOME_MCP_TOKEN`
- `OUR_HOME_INGEST_TOKEN`
- `OUR_HOME_ENROLLMENT_TOKEN` (recommended for Android auto-enrollment)
- `OUR_HOME_DATA_FILE`

## Phone credential roles

### MCP token

Server/AI administrative access. Never put it in Android.

### Ingest token

High-privilege Runtime secret. It can authenticate protected heartbeat/observations and remains the server-side secret used to derive device credentials. Do **not** embed it in an APK.

### Enrollment token

Optional lower-privilege Android bootstrap credential:

- accepted by `POST /v1/phone/register`;
- rejected by `POST /v1/phone/heartbeat`;
- rejected by `POST /v1/observations`;
- not accepted by MCP.

A private Android build may inject this value to remove manual first-run configuration. Rotation is simpler than rotating `OUR_HOME_INGEST_TOKEN` because existing registered devices continue using their device token.

### Device token

Device-scoped credential returned by registration. Android stores it in Android Keystore and uses it for normal telemetry.

## Post-restart verification

Use placeholders; do not paste real tokens into repository files or logs.

1. `GET /healthz` returns `200`.
2. `GET /v1/phone/status` without MCP token returns `401`.
3. `GET /v1/phone/status` with `Authorization: Bearer <MCP_TOKEN>` returns `200`.
4. `POST /v1/phone/heartbeat` with `Authorization: Bearer <INGEST_TOKEN>` succeeds for a valid body.
5. `POST /v1/observations` with `Authorization: Bearer <INGEST_TOKEN>` succeeds for a valid body.
6. `POST /v1/phone/register` with `<ENROLLMENT_TOKEN>` returns a device credential.
7. The same `<ENROLLMENT_TOKEN>` directly calling heartbeat/observations returns `401`.
8. The returned device credential works for heartbeat/observations.
9. Legacy bootstrap registration with `<INGEST_TOKEN>` remains supported until intentionally removed by a future migration.

## Android stable-build inputs

The user-installable stable APK workflow needs:

- repository variable `OUR_HOME_DEFAULT_RUNTIME_URL`;
- repository secret `OUR_HOME_ENROLLMENT_TOKEN`;
- fixed Android signing secrets documented in `android-companion/README.md`.

The Runtime and APK enrollment token values must match. Neither value is committed to Git.

## CI invariant

The OH-P1 HTTP integration tests launch `dist/index.js`, not `src/index.ts`. `npm test` builds first. Coverage includes both:

- high-privilege ingest-token behavior;
- register-only enrollment-token behavior.

This prevents CI from proving a route/auth rule in source while leaving the compiled production entry point untested.
