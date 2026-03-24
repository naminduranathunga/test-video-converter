require('dotenv').config();
const amqp = require('amqplib');
const AWS = require('aws-sdk');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

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

async function startWorker() {
  const maxRetries = 5;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const conn = await amqp.connect(process.env.RABBITMQ_URL);
      const channel = await conn.createChannel();
      await channel.assertQueue('conversion_jobs', { durable: true });
      await channel.assertQueue('conversion_done', { durable: true });
      console.log('Worker connected to RabbitMQ');
      console.log('Worker waiting for jobs...');
      channel.consume('conversion_jobs', async (msg) => {
        if (msg !== null) {
          const job = JSON.parse(msg.content.toString());
          console.log('Received job', job);
          const { jobId, sourceKey, format, compression } = job;
          const tempDir = path.join(__dirname, 'tmp', jobId);
          fs.mkdirSync(tempDir, { recursive: true });
          const originalPath = path.join(tempDir, path.basename(sourceKey));
          const resultKey = `${jobId}/converted_${path.parse(sourceKey).name}.${format}`;
          const resultPath = path.join(tempDir, path.basename(resultKey));

          // Download source file from S3
          const obj = await s3.getObject({ Bucket: bucket, Key: sourceKey }).promise();
          fs.writeFileSync(originalPath, obj.Body);

          // Determine ffmpeg compression options (simple mapping)
          let videoBitrate = '1500k';
          if (compression === 'low') videoBitrate = '800k';
          else if (compression === 'high') videoBitrate = '2500k';

          // Run ffmpeg conversion
          await new Promise((resolve, reject) => {
            ffmpeg(originalPath)
              .outputOptions(['-b:v', videoBitrate])
              .toFormat(format)
              .on('end', () => resolve())
              .on('error', (err) => reject(err))
              .save(resultPath);
          });

          // Upload converted file to S3
          const resultData = fs.readFileSync(resultPath);
          await s3.putObject({ Bucket: bucket, Key: resultKey, Body: resultData }).promise();

          // Notify completion
          const doneMsg = { jobId, resultKey };
          channel.sendToQueue('conversion_done', Buffer.from(JSON.stringify(doneMsg)), { persistent: true });

          // Cleanup
          fs.rmSync(tempDir, { recursive: true, force: true });

          channel.ack(msg);
          console.log('Job completed', jobId);
        }
      }, { noAck: false });
      // Successful connection, exit retry loop
      break;
    } catch (err) {
      attempt++;
      console.error(`RabbitMQ connection attempt ${attempt} failed:`, err.message);
      if (attempt >= maxRetries) {
        console.error('Max retries reached. Exiting worker.');
        process.exit(1);
      }
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

startWorker().catch(err => {
  console.error('Worker error', err);
  process.exit(1);
});
