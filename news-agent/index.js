require('dotenv').config();
const cron = require('node-cron');
const { monitorSources } = require('./src/monitor');

console.log('News Agent starting...');

// Run every 6 hours
cron.schedule('0 */6 * * *', async () => {
  console.log('Running scheduled monitoring...');
  await monitorSources();
});

// Initial run
monitorSources();