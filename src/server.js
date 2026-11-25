import { createApp } from './app.js';
import { readConfig } from './config.js';
import { FrameAnalyzer } from './services/face-analyzer.js';
import { EncryptedTemplateStore } from './services/template-store.js';

const config = readConfig();
const analyzer = new FrameAnalyzer();
await analyzer.init(); // load server-side models before accepting requests
const templateStore = new EncryptedTemplateStore(config.dataDir, { key: process.env.TEMPLATE_KEY });
const server = createApp({ ...config, analyzer, templateStore }).listen(config.port, config.host, error => {
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
