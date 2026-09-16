import { planResultReview } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { redactSecrets as redact } from './prove-e2e-redact';

// ============================================================
// REQUEST_CHANGES canônico no successor seq2 01fdf66a (em `review`), pelo MESMO
// caminho da CLI/web: planResultReview (puro) → service.reviewResult → RPC
// review_work_result_versioned (RLS residente, nunca service_role). Append-only:
// não reescreve evidência, não cria seq3, não altera predecessor. Transição
// canônica review → changes_requested. NÃO aceita, NÃO integra, NÃO faz merge.
// ============================================================

const SEQ2 = '01fdf66a-b585-4ea3-a3f8-1942a01ba817';

const REQUESTED_CHANGES = [
  'Revisão independente reprovou o resultado em review. Motivos funcionais obrigatórios (o resultado atual NÃO está apto para accept):',
  '',
  '1) PARSER ACEITA ARGUMENTOS INVÁLIDOS SILENCIOSAMENTE. resolveTaskMessage ignora tokens desconhecidos: o laço não tem ramo else, então "--task antiga --message válida" retorna "válida" em vez de erro. Isso viola o contrato de uso EXCLUSIVO de --message/--message-file. Corrigir para REJEITAR explicitamente, com Error acionável: --task, --task-file, qualquer flag desconhecida, argumentos posicionais inesperados e combinações inválidas. Preserve as mensagens de erro já acionáveis das demais fontes.',
  '',
  '2) DEFAULT_TASK_MESSAGE PERMANECE COMO CONST MORTA. O diff renomeou TASK_MESSAGE para DEFAULT_TASK_MESSAGE, mas ambos os usos migraram para a mensagem resolvida; a const não é mais referenciada. O requisito remove o default hardcoded e o runtime não deve ter fallback embutido — manter a const é uma armadilha concreta de reintrodução do comportamento antigo. Remover a const.',
  '',
  '3) FALTAM TESTES EXPLÍCITOS DO CRITÉRIO "ARGUMENTO INVÁLIDO". A suíte cobre fonte ausente, conflito de fontes, conteúdo vazio e falha de leitura, mas NÃO exercita a rejeição de --task, --task-file, flag desconhecida nem posicional inesperado. Adicionar testes que exercitem o comportamento REAL de rejeição (não confiar em gate verde como cobertura semântica): SUCESSO (--message texto; --message-file arquivo; UTF-8; preservação exata; formas inline e separada permitidas) e ERRO (sem mensagem; --message vazio; arquivo inexistente/erro de leitura sem expor conteúdo; --task; --task-file; flag desconhecida; posicional inesperado; combinações incompatíveis; ausência absoluta de fallback default).',
  '',
  'OBSERVAÇÃO DE PROVENIÊNCIA (falso positivo semântico): o Verifier considerou o critério "argumento inválido" coberto porque o gate associado passou, embora não exista teste explícito correspondente. "Gate passou" NÃO implica "todo critério semântico coberto". Registrado como dívida técnica de mapeamento de evidência, separada; não bloqueia a recovery depois que os critérios reais estiverem testados.',
  '',
  'Manter o diff restrito aos 2 arquivos aprovados (prove-openai-strong-e2e.ts e prove-openai-strong-e2e.test.ts), estender o arquivo Jest existente e usar somente o Jest do repositório.',
].join('\n');

async function main(): Promise<void> {
  const identityResult = await resolveCliIdentity();
  if (!identityResult.ok) throw new Error(identityResult.error);
  const { client } = identityResult.identity;
  const service = createWorkOrchestrationService(client);

  const item = await service.getItem(SEQ2);
  if (!item.ok) throw new Error(`getItem recusado: ${item.error.code} ${item.error.message}`);
  const events = await service.listEvents(SEQ2);
  if (!events.ok) throw new Error(`listEvents recusado: ${events.error.code} ${events.error.message}`);

  const plan = planResultReview(item.value, events.value, {
    type: 'request_changes',
    requestedChanges: REQUESTED_CHANGES,
  });
  if (!plan.ok) throw new Error(`planResultReview recusou: ${plan.reason} (estado atual: ${item.value.state}).`);

  const reviewed = await service.reviewResult(plan.command);
  if (!reviewed.ok) throw new Error(`reviewResult recusado: ${reviewed.error.code} ${reviewed.error.message}`);

  console.log(redact(JSON.stringify({
    stage: 'request_changes_persisted',
    workItemId: reviewed.value.id,
    previousState: item.value.state,
    newState: reviewed.value.state,
    proposalVersion: reviewed.value.proposalVersion,
    reviewedResultEventId: plan.command.reviewedResultEventId,
  }, null, 2)));
}

void main().catch(error => {
  console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
