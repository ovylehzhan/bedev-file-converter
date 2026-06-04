# File Converter Microservices

Microservice-based document conversion system using CloudConvert API. Built with NestJS, PostgreSQL, Redis, and Docker.

## Architecture

```
                                    ┌─────────────────┐
                              ┌────▶│  Job Storage     │◀────┐
                              │     │  (PostgreSQL)    │     │
                              │     └─────────────────┘     │
                              │                              │
┌──────────┐    POST /conv    │     ┌─────────────────┐     │     ┌───────────────┐
│          │─────────────────▶│     │   Queue          │     │     │               │
│  Client  │                  │────▶│  (Redis/BullMQ)  │────▶│     │  CloudConvert  │
│          │◀─── SSE events   │     └─────────────────┘     │────▶│  API           │
└──────────┘                  │                              │     └───────────────┘
     │                   ┌────┴────┐                   ┌────┴─────────┐
     │                   │   API    │                   │  Conversion   │
     │                   │ Gateway  │                   │  Service      │
     │                   │ :3000    │                   │  (BullMQ      │
     │                   └─────────┘                   │   Worker)     │
     │                        │                         └──────┬───────┘
     │                        │   Redis PubSub                 │
     │                        │◀───────────────────────────────┘
     │                        │         ┌─────────────────────┐
     │                        └────────▶│  Notification        │
     │                                  │  Service :3002       │
     └──────────────────────────────────│  (Event Routing)     │
                                        └─────────────────────┘
```

### Services

| Service | Port | Responsibility |
|---------|------|----------------|
| **API Gateway** | 3000 | HTTP API, file upload, SSE, job CRUD |
| **Conversion Service** | 3001 | BullMQ worker, CloudConvert integration, rate limiting |
| **Notification Service** | 3002 | Redis PubSub listener, event logging, extensible notifications |

### Communication

- **API Gateway → Conversion Service:** via BullMQ queue (Redis)
- **Conversion Service → API Gateway:** via Redis PubSub → SSE to client
- **Conversion Service → Notification Service:** via Redis PubSub
- **Shared state:** PostgreSQL (conversion_jobs table)
- **Shared storage:** Docker volume (uploaded files)

### Rate Limiting

BullMQ processor concurrency is set to `MAX_CONCURRENT_JOBS` (default: 30). When the limit is reached, new jobs wait in the queue. This ensures CloudConvert API limits are respected.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- CloudConvert API key ([get free key](https://cloudconvert.com/dashboard/api/v2/keys) — 25 conversions/day)

### Setup

```bash
# 1. Clone and configure
git clone <repository-url>
cd bedev-file-converter
cp .env.example .env

# 2. Add your CloudConvert API key to .env
# CLOUDCONVERT_API_KEY=your_key_here

# 3. Start everything
docker compose up --build
```

All services will be available:
- API Gateway: http://localhost:3000
- Conversion Service health: http://localhost:3001/health
- Notification Service health: http://localhost:3002/health

## Web UI

A minimal single-page UI is served at **http://localhost:3000/** — pick a file,
choose a target format, and watch live progress (via SSE) until the download
link appears. Format and size are validated client-side (instant feedback) and
server-side. No build step — it's a self-contained HTML page served by the API
Gateway.

## Supported Formats

Input and output formats are validated against a whitelist (case-insensitive):

| | Formats |
|---|---|
| **Supported** | `pdf`, `docx`, `xlsx`, `pptx`, `png`, `jpg` (`jpeg`) |
| **Max file size** | 2 GB |

- Unsupported source/target format → `400 Bad Request` with a clear message.
- File larger than 2 GB → `413 Payload Too Large`.
- The actual conversion is performed by CloudConvert; an unsupported *pair*
  (e.g. `png → xlsx`) passes validation but may fail at CloudConvert and the
  job becomes `failed` with the provider's error.

## API Endpoints

### Create Conversion Job

```bash
curl -X POST http://localhost:3000/conversions \
  -F "file=@example.docx" \
  -F "targetFormat=pdf"
```

Response:
```json
{"jobId": "job_a1b2c3d4", "status": "pending"}
```

### Check Job Status

```bash
curl http://localhost:3000/conversions/job_a1b2c3d4/status
```

Response (in progress):
```json
{"jobId": "job_a1b2c3d4", "status": "in_progress", "createdAt": "...", "updatedAt": "..."}
```

Response (done):
```json
{"jobId": "job_a1b2c3d4", "status": "done", "downloadUrl": "http://localhost:3000/conversions/job_a1b2c3d4/result"}
```

Response (failed):
```json
{"jobId": "job_a1b2c3d4", "status": "failed", "error": "CloudConvert conversion failed"}
```

### Subscribe to SSE Events

```bash
curl http://localhost:3000/conversions/job_a1b2c3d4/events
```

Or open in browser: `http://localhost:3000/conversions/job_a1b2c3d4/events`

Events:
```
event: status
data: {"jobId":"job_a1b2c3d4","status":"in_progress"}

event: completed
data: {"jobId":"job_a1b2c3d4","status":"done","downloadUrl":"http://localhost:3000/conversions/job_a1b2c3d4/result"}
```

### Get Conversion Result

```bash
curl http://localhost:3000/conversions/job_a1b2c3d4/result
```

### List All Jobs

```bash
curl http://localhost:3000/conversions
```

### Get Job Details

```bash
curl http://localhost:3000/conversions/job_a1b2c3d4
```

### Cancel Job

```bash
curl -X POST http://localhost:3000/conversions/job_a1b2c3d4/cancel
```

### Health Checks

```bash
curl http://localhost:3000/health   # API Gateway
curl http://localhost:3001/health   # Conversion Service
curl http://localhost:3002/health   # Notification Service
```

## User Flow

```
1.  Client sends file via POST /conversions
2.  API Gateway saves file to shared storage
3.  API Gateway creates job (status: pending) in PostgreSQL
4.  API Gateway adds job to BullMQ queue
5.  Conversion Service consumes job from queue
6.  Conversion Service updates status → in_progress
7.  Conversion Service calls CloudConvert API
8.  CloudConvert performs the conversion
9.  Conversion Service receives result
10. Conversion Service updates status → done/failed
11. Conversion Service publishes event to Redis PubSub
12. API Gateway SSE endpoint receives event
13. Client receives SSE notification
14. Client downloads the converted file
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript |
| Framework | NestJS 10 |
| Database | PostgreSQL 16 |
| Queue / PubSub | Redis 7 + BullMQ |
| File Conversion | CloudConvert API |
| Containerization | Docker + Docker Compose |

## Testing

### Unit tests

Each service has unit tests (Jest + ts-jest, fully mocked — no DB/Redis needed):

```bash
cd services/api-gateway && npm test        # 16 tests
cd services/conversion-service && npm test  # 4 tests
cd services/notification-service && npm test # 3 tests
```

Coverage: job CRUD logic, status response shaping, cancel guards, SSE event
type mapping + jobId filtering, conversion status transitions (success/error),
event routing.

### Manual end-to-end test

With the stack running (`docker compose up --build`):

```bash
# Health checks
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health

# Create a job
curl -X POST http://localhost:3000/conversions -F "file=@example.txt" -F "targetFormat=pdf"

# Check status (use the returned jobId)
curl http://localhost:3000/conversions/<jobId>/status

# Watch live events in the browser
open http://localhost:3000/conversions/<jobId>/events
```

> Without a valid `CLOUDCONVERT_API_KEY`, jobs reach CloudConvert and fail with
> `Unauthorized` — this still exercises the full queue → worker → PubSub → SSE
> pipeline. Add a real key to perform actual conversions.

## Known Limitations

- **Format pairs:** Source/target formats are whitelist-validated, but a valid *pair* is not guaranteed — an exotic combination may still fail at CloudConvert.
- **Cancel job:** If CloudConvert job is already processing, we can only mark the local job as failed. CloudConvert may still complete the conversion.
- **File storage:** Files are stored in a Docker volume. In production, use S3 or similar object storage.
- **Authentication:** No auth implemented. In production, add JWT/session-based auth.
- **synchronize: true:** TypeORM auto-creates tables. In production, use migrations.
