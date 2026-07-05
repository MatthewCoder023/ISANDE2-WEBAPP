require('dotenv').config();

const connectDB = require('./src/config/db');
const createApp = require('./src/app');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    if (!process.env.SESSION_SECRET) {
      throw new Error('SESSION_SECRET is not set. Copy .env.example to .env and configure it.');
    }

    await connectDB(process.env.MONGODB_URI);

    const app = createApp();
    app.listen(PORT, () => {
      console.log(`Flavor & Color server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
