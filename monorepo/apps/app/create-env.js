import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Define the environment variables you want to write
const envVariables = `
VITE_SERVER_URL=${process.env.VITE_SERVER_URL}
VITE_ASSET_URL=${process.env.VITE_ASSET_URL}
`;

// Write the .env file in the correct directory
const envFilePath = resolve('./.env'); // Adjust path as needed

writeFileSync(envFilePath, envVariables, (err) => {
  if (err) {
    console.error('Error writing .env file', err);
  } else {
    console.log('.env file created successfully');
  }
});
