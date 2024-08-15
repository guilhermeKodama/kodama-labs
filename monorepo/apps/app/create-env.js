import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Log to confirm the script is running
console.log('[🍓]', 'Starting create-env.js script...');

// Define the environment variables you want to write
const envVariables = `
VITE_SERVER_URL=${process.env.VITE_SERVER_URL}
VITE_ASSET_URL=${process.env.VITE_ASSET_URL}
`;

// Log the environment variables to confirm they are being read
console.log('[🍓]', 'Environment Variables:');
console.log('[🍓]', `VITE_SERVER_URL=${process.env.VITE_SERVER_URL}`);
console.log('[🍓]', `VITE_ASSET_URL=${process.env.VITE_ASSET_URL}`);

// Write the .env file in the correct directory
const PATHS = [resolve('./.env'), resolve('apps/app/.env'), resolve('monorepo/apps/app/.env')];

for (const path of PATHS) {
  try {
    writeFileSync(path, envVariables);
    console.log('[🍓]', `.env file created successfully at ${path}`);
  } catch (err) {
    console.error('[🍓]', 'Error writing .env file:', err);
  }
}
