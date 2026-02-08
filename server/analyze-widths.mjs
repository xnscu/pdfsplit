
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function analyzeWidths() {
  const inputFile = path.join(__dirname, 'image-widths.json');

  console.log(`Reading ${inputFile}...`);
  try {
    const data = await fs.readFile(inputFile, 'utf8');
    const json = JSON.parse(data);

    if (!json.images || !Array.isArray(json.images)) {
      console.error('Invalid JSON format: "images" array not found.');
      return;
    }

    const images = json.images;
    const totalImages = images.length;
    console.log(`Total images processed: ${totalImages}`);

    // Extract all widths
    const widths = images.map(img => img.width);

    // Deduplicate using Set
    const uniqueWidths = [...new Set(widths)];

    // Sort descending
    uniqueWidths.sort((a, b) => b - a);

    const countUnique = uniqueWidths.length;

    console.log(`\nUnique widths found: ${countUnique}`);
    console.log('Unique widths (descending):');
    console.log(uniqueWidths.join(', '));

    // Optional: Show distribution (top 10 most common widths) just for extra insight
    console.log('\nTop 10 most common widths:');
    const frequency = {};
    for (const w of widths) {
      frequency[w] = (frequency[w] || 0) + 1;
    }
    const sortedFrequency = Object.entries(frequency)
      .sort(([, countA], [, countB]) => countB - countA)
      .slice(0, 10);

    sortedFrequency.forEach(([width, count], index) => {
        console.log(`${index + 1}. Width ${width}px: ${count} occurrences`);
    });

  } catch (err) {
    console.error(`Error reading or processing file: ${err.message}`);
  }
}

analyzeWidths();
