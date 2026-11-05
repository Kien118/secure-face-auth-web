import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const server = createApp(config).listen(config.port, config.host, () => {
  console.log(`Day 1 identity baseline: http://${config.host}:${server.address().port}`);
});
server.on('error', () => { console.error('Server failed to start. Check HOST/PORT.'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close());
}
