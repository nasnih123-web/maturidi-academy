// Run axe-core against a mirrored file:// page via CDP; save violations JSON + screenshot.
// Usage: node axe-run.mjs <pageDir> <outJson> <outPng> [--wait ms]
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const AXE_SRC = fs.readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const [, , pageDir, outJson, outPng, ...rest] = process.argv;
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i]] = rest[i + 1];
const WAIT = Number(opts['--wait'] || 5000);
if (!pageDir || !outJson || !outPng) { console.error('usage: axe-run.mjs <pageDir> <outJson> <outPng>'); process.exit(1); }

const url = 'file://' + path.resolve(pageDir, 'index.html');
const PORT = 9444;
execFileSync('rm', ['-rf', path.join(HERE, '.chrome-profile')]);
const CHROME_BIN = process.env.CHROME_BIN || '/opt/meta-chromium/chrome';
const chrome = spawn(CHROME_BIN, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--window-size=1440,900', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${HERE}/.chrome-profile`,
  'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1800));

let targets = null;
for (let i = 0; i < 10; i++) {
  try {
    const out = execFileSync('curl', ['-s', `http://127.0.0.1:${PORT}/json/list`]).toString();
    if (out) { targets = JSON.parse(out); break; }
  } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!targets) throw new Error('chrome CDP endpoint not reachable');
const page = targets.find((t) => t.type === 'page');
const wsUrl = new URL(page.webSocketDebuggerUrl);

function wsConnect() {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(wsUrl.port, wsUrl.hostname, () => {
      sock.write(
        `GET ${wsUrl.pathname}${wsUrl.search} HTTP/1.1\r\n` +
        `Host: ${wsUrl.hostname}:${wsUrl.port}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let buf = Buffer.alloc(0);
    let handshook = false;
    const pending = new Map();
    let id = 0;
    const api = {
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const myId = ++id;
          pending.set(myId, { res, rej });
          const payload = Buffer.from(JSON.stringify({ id: myId, method, params }));
          const mask = crypto.randomBytes(4);
          let header;
          if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
          else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
          else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
          const masked = Buffer.alloc(payload.length);
          for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
          sock.write(Buffer.concat([header, mask, masked]));
          setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); rej(new Error('cdp timeout ' + method)); } }, 90000);
        });
      },
      close() { sock.destroy(); },
    };
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshook) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buf.slice(0, idx).toString();
        if (!head.includes('101')) { reject(new Error('ws handshake failed: ' + head.slice(0, 80))); return; }
        handshook = true;
        buf = buf.slice(idx + 4);
        resolve(api);
        return;
      }
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf[1] & 0x80) { off += 4; }
        if (buf.length < off + len) break;
        const payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (opcode === 0x8) { sock.destroy(); return; }
        if (opcode === 0x9) { sock.write(Buffer.from([0x8a, 0x00])); continue; }
        if (opcode !== 0x1) continue;
        try {
          const msg = JSON.parse(payload.toString());
          if (msg.id && pending.has(msg.id)) {
            const { res, rej } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) rej(new Error(JSON.stringify(msg.error)));
            else res(msg.result);
          }
        } catch { /* ignore */ }
      }
    });
    sock.on('error', reject);
  });
}

try {
  const ws = await wsConnect();
  await ws.send('Runtime.enable');
  await ws.send('Page.enable');
  await ws.send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, WAIT));

  const inj = await ws.send('Runtime.evaluate', { expression: AXE_SRC, returnByValue: true });
  if (inj.exceptionDetails) throw new Error('axe inject failed: ' + JSON.stringify(inj.exceptionDetails).slice(0, 300));

  const run = await ws.send('Runtime.evaluate', {
    expression: `axe.run(document, { resultTypes: ['violations'] }).then(r => JSON.stringify({
      violations: r.violations.map(v => ({
        id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 5).map(n => n.target.join(' ')),
        html: v.nodes.slice(0, 3).map(n => n.html.slice(0, 220)),
      })),
      passes: r.passes.length, incomplete: r.incomplete.length,
    }))`,
    awaitPromise: true, returnByValue: true,
  });
  if (run.exceptionDetails) throw new Error('axe run failed: ' + JSON.stringify(run.exceptionDetails).slice(0, 500));
  const result = JSON.parse(run.result.value);
  result.page = url;
  fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
  console.log(`violations=${result.violations.length} passes=${result.passes} incomplete=${result.incomplete}`);

  const { data } = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outPng, Buffer.from(data, 'base64'));
  console.log('saved', outPng);
  ws.close();
} finally {
  chrome.kill();
}
