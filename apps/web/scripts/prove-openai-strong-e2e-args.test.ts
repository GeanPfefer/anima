import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProveOpenaiStrongE2eArgs } from './prove-openai-strong-e2e-args';

test('aceita e preserva exatamente a mensagem de tarefa recebida em runtime', () => {
  const message = '  Corrija somente o teste de regressão solicitado.  ';

  assert.equal(parseProveOpenaiStrongE2eArgs([message]), message);
});

test('rejeita ausência ou multiplicidade de mensagens', () => {
  assert.throws(() => parseProveOpenaiStrongE2eArgs([]), /Uso:/);
  assert.throws(() => parseProveOpenaiStrongE2eArgs(['uma tarefa', 'outra tarefa']), /Uso:/);
});

test('rejeita mensagem vazia ou composta apenas por espaços', () => {
  assert.throws(() => parseProveOpenaiStrongE2eArgs(['']), /não pode estar vazia/);
  assert.throws(() => parseProveOpenaiStrongE2eArgs([' \t\n ']), /não pode estar vazia/);
});
