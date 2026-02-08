/**
 * Find Max Width Script
 *
 * Scans all exam questions to find the maximum image width.
 * Generates a report 'image-widths.json' and updates task status.
 *
 * Usage: node find-max-width.mjs
 */

import sharp from 'sharp';
import dotenv from 'dotenv';
import fs from 'fs/promises';
// import { fetch } from 'undici';

dotenv.config();

// ============ Configuration ============

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      let key = arg.slice(2);
      let value = true;
      if (key.includes('=')) {
        const parts = key.split('=');
        key = parts[0];
        value = parts.slice(1).join('=');
      } else if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
        value = process.argv[i + 1];
        i++;
      }
      args[key.toUpperCase().replace(/-/g, '_')] = value;
    }
  }
  return args;
}

const args = parseArgs();

const CONFIG = {
  API_BASE_URL: args.API_BASE_URL || process.env.API_BASE_URL || 'https://gksx.xnscu.com',
  CDN_URL: args.CDN_URL || process.env.CDN_URL || 'https://r2-gksx.xnscu.com',
  CONCURRENCY: parseInt(args.CONCURRENCY || 20),
  TASK_ID: 'find-max-width'
};

// ============ API Client ============

class CloudApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async fetch(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`API Error ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (err) {
      console.error(`Fetch failed for ${url}:`, err.message);
      throw err;
    }
  }

  async getExams() {
    const res = await this.fetch('/api/exams/');
    return res.json();
  }

  async getExam(id) {
    const res = await this.fetch(`/api/exams/${id}`);
    return res.json();
  }

  async getImage(hash) {
    // Try public CDN first
    const cdnUrl = `${CONFIG.CDN_URL}/${hash}`;
    try {
      const res = await fetch(cdnUrl);
      if (res.ok) return await res.arrayBuffer();
    } catch (e) {
      // ignore
    }

    // Fallback to API
    const res = await this.fetch(`/api/r2/${hash}`);
    return await res.arrayBuffer();
  }

  async updateTaskStatus(status, total, processed, metadata) {
    await this.fetch(`/api/tasks/${CONFIG.TASK_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, total, processed, metadata })
    });
  }
}

// ============ Scanner ============

class WidthScanner {
  constructor() {
    this.client = new CloudApiClient(CONFIG.API_BASE_URL);
    this.questions = [];
    this.results = [];
    this.maxWidth = 0;
    this.maxImage = null;
  }

  async run() {
    console.log(`Starting Width Scan (Concurrency: ${CONFIG.CONCURRENCY})`);
    await this.client.updateTaskStatus('running', 0, 0, { message: 'Fetching exam list...' });

    // 1. Fetch all exams and build question list
    const exams = await this.client.getExams();
    console.log(`Found ${exams.length} exams.`);

    let qCount = 0;
    for (const examMeta of exams) {
      // Optimization: We could parallelize fetching exams if there are many
      const exam = await this.client.getExam(examMeta.id);
      if (exam.questions && exam.questions.length > 0) {
        for (const q of exam.questions) {
          if (this.isHash(q.data_url)) {
            this.questions.push({
              examName: exam.name,
              ...q
            });
          }
        }
      }
      qCount = this.questions.length;
      process.stdout.write(`\rFetching questions... ${qCount}`);
    }
    console.log(`\nTotal questions with hash images: ${this.questions.length}`);

    await this.client.updateTaskStatus('running', this.questions.length, 0, { message: 'Scanning image widths...' });

    // 2. Scan images
    const batches = [];
    for (let i = 0; i < this.questions.length; i += CONFIG.CONCURRENCY) {
      batches.push(this.questions.slice(i, i + CONFIG.CONCURRENCY));
    }

    let processed = 0;

    for (const batch of batches) {
      await Promise.all(batch.map(async (q) => {
        try {
          const buffer = await this.client.getImage(q.data_url);
          const meta = await sharp(buffer).metadata();

          const info = {
            exam_id: q.exam_id,
            question_id: q.id,
            hash: q.data_url,
            width: meta.width,
            height: meta.height
          };

          this.results.push(info);

          if (meta.width > this.maxWidth) {
            this.maxWidth = meta.width;
            this.maxImage = info;
          }

        } catch (e) {
          console.error(`Error processing Q ${q.id}:`, e.message);
        }
      }));

      processed += batch.length;
      const progress = Math.round((processed / this.questions.length) * 100);
      process.stdout.write(`\rScanning: ${processed}/${this.questions.length} (${progress}%) - Current Max: ${this.maxWidth}px`);

      // Update task status periodically
      if (processed % 50 === 0) {
        await this.client.updateTaskStatus('running', this.questions.length, processed, {
          message: `Scanning images... Max: ${this.maxWidth}px`,
          maxWidth: this.maxWidth
        });
      }
    }

    console.log(`\n\nScan Complete.`);
    console.log(`Max Width: ${this.maxWidth}px`);
    if (this.maxImage) {
      console.log(`Widest Image: ${JSON.stringify(this.maxImage, null, 2)}`);
    }

    // Save results
    await fs.writeFile('image-widths.json', JSON.stringify({
      maxWidth: this.maxWidth,
      maxImage: this.maxImage,
      timestamp: new Date().toISOString(),
      images: this.results
    }, null, 2));

    console.log('Results saved to image-widths.json');

    await this.client.updateTaskStatus('completed', this.questions.length, processed, {
      message: 'Scan complete',
      maxWidth: this.maxWidth,
      maxImage: this.maxImage
    });
  }

  isHash(str) {
    return /^[a-f0-9]{64}$/i.test(str);
  }
}

const scanner = new WidthScanner();
scanner.run().catch(err => {
  console.error(err);
  process.exit(1);
});
