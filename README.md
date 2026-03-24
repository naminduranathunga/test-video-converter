# Simple Video Converter

A lightweight video conversion platform built with two Node.js micro‑services and a static frontend. Users can upload a video, choose a target format and compression level, watch real‑time progress, and download the converted file.

## Architecture
- **Service 1 (API)** – Express server handling uploads, downloads, and publishing conversion jobs to RabbitMQ.
- **Service 2 (Worker)** – Node.js worker that consumes jobs, runs `ffmpeg` (via `fluent‑ffmpeg`), stores results in an S3‑compatible bucket (MinIO).
- **Frontend** – Static HTML/CSS/JS served by Nginx, communicates with the API via HTTP and Server‑Sent Events for progress.
- **RabbitMQ** – Message broker for job dispatch.
- **MinIO** – Local S3‑compatible storage for source and converted videos.

## Prerequisites
- Docker & Docker‑Compose installed.
- `ffmpeg` is bundled via `ffmpeg-static` inside the worker container.

## Quick Start
1. **Clone the repository**
   ```bash
   git clone <repo‑url>
   cd test-video-recorder
   ```
2. **Create environment files** (see the sample `.env` files below).
3. **Start the stack**
   ```bash
   docker-compose up --build
   ```
   This will build the two Node services, start RabbitMQ, MinIO and an Nginx frontend.
4. **Open the UI**
   Visit `http://localhost:8080` in your browser.
5. **Convert a video**
   - Choose a video file.
   - Select the desired format (mp4, webm, avi) and compression level.
   - Click **Convert** and watch the progress bar.
   - When conversion finishes, a download link appears.

## Environment Variables
### Service 1 (`service1/.env`)
```
PORT=3001
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=videos
```
### Service 2 (`service2/.env`)
```
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=videos
```
### MinIO (configured via Docker‑Compose)
- Access the console at `http://localhost:9001` using the credentials above.
- A bucket named `videos` is created automatically on startup.

## Stopping the Stack
```bash
docker-compose down -v
```
The `-v` flag removes the MinIO data volume.

## Notes
- The API uses Server‑Sent Events (`/progress/:jobId`) to push simple progress updates. In a production system you would replace the placeholder ping with real progress from the worker (e.g., via Redis pub/sub).
- `ffmpeg-static` provides a portable binary, so no additional system dependencies are required.
- All services are containerised; you can adapt the Dockerfiles or the `docker-compose.yml` for deployment to other environments.
