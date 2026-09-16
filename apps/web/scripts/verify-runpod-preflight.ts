// OPERACIONAL / TEMPORÁRIO (não commitar): valida que .env.local parseia e que a ÚNICA
// condição de preflight faltante é a API key (segredo humano). Read-only, no-spend, sem DB.
import { assessPaidComputePreflight } from '@/lib/work-orchestration/paid-compute-preflight';
import { readRunPodProvisionerConfig } from '@/lib/work-orchestration/runpod-node-provisioner';
import { readResidentOnDemandNodeConfig } from '@/lib/work-orchestration/resident-on-demand-node';

const line = (k: string, v: unknown) => console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);

// 1) Preflight com o ambiente REAL (chave ausente).
const real = assessPaidComputePreflight({ env: process.env });
console.log('== PREFLIGHT (ambiente real) ==');
line('infraReady', real.infraReady);
line('readyForHumanPaidAuthorization', real.readyForHumanPaidAuthorization);
line('missing', real.missing);

// 2) Config do adapter com a chave AUSENTE => fail-closed (null).
line('readRunPodProvisionerConfig(real)==null', readRunPodProvisionerConfig(process.env) === null);

// 3) Config do adapter com uma chave FICTÍCIA em memória (prova o parsing dos DEMAIS campos).
const fakeEnv = { ...process.env, ANIMA_RUNPOD_API_KEY: 'FAKE_FOR_PARSING_ONLY' };
const cfg = readRunPodProvisionerConfig(fakeEnv);
console.log('== ADAPTER CONFIG (com chave fictícia só p/ parsing) ==');
if (!cfg) { console.log('cfg=null (INESPERADO)'); } else {
  line('imageName', cfg.imageName);
  line('gpuTypeIds', cfg.gpuTypeIds);
  line('gpuCount', cfg.gpuCount);
  line('cloudType', cfg.cloudType);
  line('inferencePort', cfg.inferencePort);
  line('sshPrivateKeyPath', cfg.sshPrivateKeyPath);
  line('sshKnownHostsPath', cfg.sshKnownHostsPath);
  line('sshPublicKey.startsWith(ssh-ed25519)', cfg.sshPublicKey.startsWith('ssh-ed25519'));
  line('podEnv', cfg.podEnv);
  line('apiKeyRedactedNeverPrinted', cfg.apiKey === 'FAKE_FOR_PARSING_ONLY');
}

// 4) On-demand config resolvida com a chave fictícia (nodeId/resourceClass p/ casar a autorização).
const od = readResidentOnDemandNodeConfig('qwen3-coder:latest', fakeEnv);
console.log('== ON-DEMAND CONFIG ==');
if (!od) { console.log('onDemand=null (INESPERADO)'); } else {
  line('nodeId', od.nodeId);
  line('providerId', od.providerId);
  line('resourceClass', od.resourceClass);
  line('billingMode', od.billingMode);
  line('maxActiveDurationMs', od.maxActiveDurationMs);
  line('maxConcurrentPaidNodes', od.maxConcurrentPaidNodes);
  line('priceHint', od.priceHint);
}

// 5) Preflight HIPOTÉTICO com chave presente + autorização humana válida => pronto p/ gasto.
const hypo = assessPaidComputePreflight({ env: fakeEnv, humanAuthorizationValid: true });
console.log('== PREFLIGHT (hipotético: chave presente + autorização) ==');
line('infraReady', hypo.infraReady);
line('readyForHumanPaidAuthorization', hypo.readyForHumanPaidAuthorization);
line('paidExecutionAuthorized', hypo.paidExecutionAuthorized);
line('missing', hypo.missing);
