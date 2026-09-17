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
    // Coding Harness V3: o laço agêntico governa a máquina de estados de submit — o
    // host anuncia por rodada o estado atual e SUBMIT só existe em READY_TO_SUBMIT.
    // Este node fake completa o protocolo real (EDIT → validação focal → git diff →
    // SUBMIT), reagindo ao marcador de estado que o próprio prompt carrega. Em tarefas
    // sem gate executável o estado vira READY_TO_SUBMIT logo após o EDIT (retrocompat).
    let prompt = '';
    try {
      const payload = JSON.parse(body);
      prompt = payload?.messages?.at?.(-1)?.content || payload?.prompt || '';
    } catch { /* resposta inválida será tratada como estado inicial */ }
    const state = /Ações permitidas nesta rodada \(estado (exploring|dirty_unvalidated|dirty_validated|ready_to_submit)\)/
      .exec(prompt)?.[1] || 'exploring';
    let action;
    if (state === 'ready_to_submit') {
      action = { action: 'submit' };
    } else if (state === 'dirty_validated') {
      action = { action: 'exec', program: 'git', args: ['diff'] };
    } else if (state === 'dirty_unvalidated') {
      action = { action: 'exec', program: 'npm', args: ['test'] };
    } else {
      action = { action: 'edit', operations: [{ kind: 'create_file', path: targetPath, content: targetContent }] };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      message: { content: JSON.stringify(action) },
      // Deve ser >= à estimativa do prompt V3; um valor pequeno simularia truncamento
      // do provider e encerraria o protocolo antes de exercitar a state machine.
      prompt_eval_count: 100000,
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
