const fs = require('fs');
const path = require('path');

// Define the environment variables you want to write
const envVariables = `
VITE_SERVER_URL=${process.env.VITE_SERVER_URL}
VITE_ASSET_URL=${process.env.VITE_ASSET_URL}
`;

// Write the .env file in the correct directory
const envFilePath = path.resolve(__dirname, './.env'); // Adjust path as needed

fs.writeFileSync(envFilePath, envVariables, (err) => {
  if (err) {
    console.error('Error writing .env file', err);
  } else {
    console.log('.env file created successfully');
  }
});
