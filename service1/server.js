require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const amqp = require('amqplib');
const AWS = require('aws-sdk');
const EventEmitter = require('events');

const app = express();
const eventEmitter = new EventEmitter();
app.use(cors());
app.use(express.json());

// Configure S3 (MinIO compatible)
const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT,
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_KEY,
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});
const bucket = process.env.S3_BUCKET;

// Ensure bucket exists
async function ensureBucket() {
  try {
    await s3.headBucket({ Bucket: bucket }).promise();
  } catch (err) {
    if (err.statusCode === 404) {
      console.log(`Bucket ${bucket} not found, creating...`);
      await s3.createBucket({ Bucket: bucket }).promise();
    } else {
      throw err;
    }
  }
}
ensureBucket().catch(console.error);

// Multer storage (in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// RabbitMQ channel (initialized lazily)
let channel;
async function getChannel() {
  if (channel) return channel;
  const conn = await amqp.connect(process.env.RABBITMQ_URL);
  channel = await conn.createChannel();
  await channel.assertQueue('conversion_jobs', { durable: true });
  await channel.assertQueue('conversion_done', { durable: true });

  // Consume completion messages
  channel.consume('conversion_done', (msg) => {
    if (msg !== null) {
      const data = JSON.parse(msg.content.toString());
      console.log('Conversion done for job:', data.jobId);
      eventEmitter.emit(`done:${data.jobId}`, data);
      channel.ack(msg);
    }
  });

  return channel;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Upload endpoint
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const jobId = uuidv4();
  const originalKey = `${jobId}/original_${req.file.originalname}`;
  // Upload original file to S3
  await s3.putObject({ Bucket: bucket, Key: originalKey, Body: req.file.buffer }).promise();
  // Publish conversion job
  const channel = await getChannel();
  const msg = {
    jobId,
    sourceKey: originalKey,
    format: req.body.format || 'mp4',
    compression: req.body.compression || 'medium'
  };
  channel.sendToQueue('conversion_jobs', Buffer.from(JSON.stringify(msg)), { persistent: true });
  res.json({ jobId });
});

// Download endpoint
app.get('/download/:key(*)', async (req, res) => {
  const key = req.params.key;
  console.log('Download request for key:', key);
  try {
    const obj = await s3.getObject({ Bucket: bucket, Key: key }).promise();
    res.set('Content-Type', obj.ContentType || 'application/octet-stream');
    res.send(obj.Body);
  } catch (e) {
    res.status(404).json({ error: 'File not found' });
  }
});

// SSE endpoint for progress
app.get('/progress/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  res.set({
    'Cache-Control': 'no-cache',
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive'
  });

  // Listener for completion
  const onDone = (data) => {
    res.write(`data: ${JSON.stringify({ status: 'done', resultKey: data.resultKey })}\n\n`);
  };

  eventEmitter.once(`done:${jobId}`, onDone);

  // Keep-alive ping
  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ jobId, status: 'processing' })}\n\n`);
  }, 3000);

  req.on('close', () => {
    clearInterval(interval);
    eventEmitter.removeListener(`done:${jobId}`, onDone);
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Service 1 listening on port ${PORT}`);
  try {
    await getChannel();
    console.log('Connected to RabbitMQ and consuming completion messages.');
  } catch (err) {
    console.error('Failed to connect to RabbitMQ on startup:', err.message);
  }
});
