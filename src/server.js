import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const server = createApp(config).listen(config.port, config.host, error => {
  if (error) return;
  console.log(`Face authentication PoC: http://${config.host}:${server.address().port}`);
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${config.port} is already in use (EADDRINUSE). Open the running app or choose another PORT.`
    : 'Server failed to start. Check HOST/PORT.');
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close());
}
