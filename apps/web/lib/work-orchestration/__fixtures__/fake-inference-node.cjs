'use strict';
// Endpoint de inferência FAKE-REALISTA para a prova de Provisionamento On-Demand V1.
// É um PROCESSO REAL (não um mock puro): sobe um servidor HTTP no loopback, faz health-check
// por GET e devolve uma operação do protocolo Ollama (host-mediado) em POST. Iniciado e
// desligado pelo LocalProcessNodeProvisioner através da MESMA porta que um provider real usa.
//
// Env de controle (para as provas negativas):
//   FAKE_NODE_TARGET_PATH / FAKE_NODE_TARGET_CONTENT — a operação de edição devolvida.
//   FAKE_NODE_UNHEALTHY=1 — responde 503 no health (prova health_failed).
//   FAKE_NODE_CRASH_ON_POST=1 — encerra o processo ao receber trabalho (prova queda em uso).
const http = require('http');

const targetPath = process.env.FAKE_NODE_TARGET_PATH || 'src/added.ts';
const targetContent = process.env.FAKE_NODE_TARGET_CONTENT || 'export const two = 2;\n';
const unhealthy = process.env.FAKE_NODE_UNHEALTHY === '1';
const crashOnPost = process.env.FAKE_NODE_CRASH_ON_POST === '1';

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    if (unhealthy) { res.writeHead(503); res.end('unhealthy'); return; }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (crashOnPost) { server.close(() => process.exit(1)); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      message: {
        content: JSON.stringify({
          action: 'edit',
          operations: [{ kind: 'create_file', path: targetPath, content: targetContent }],
        }),
      },
      prompt_eval_count: 1000,
      eval_count: 50,
      done_reason: 'stop',
    }));
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write('READY PORT=' + address.port + '\n');
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
