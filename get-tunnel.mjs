import localtunnel from './node_modules/localtunnel/localtunnel.js';
import { writeFileSync } from 'node:fs';
const tunnel = await localtunnel({ port: 5051 });
writeFileSync('/tmp/tunnel-url.txt', tunnel.url);
process.stdout.write(tunnel.url + '\n');
// keep alive indefinitely
await new Promise(() => {});
