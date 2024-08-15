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
const envFilePath = resolve('./.env'); // Adjust path as needed

try {
  writeFileSync(envFilePath, envVariables);
  console.log('[🍓]', `.env file created successfully at ${envFilePath}`);
} catch (err) {
  console.error('[🍓]', 'Error writing .env file:', err);
}
