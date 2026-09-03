# Evidência persistente READ → EDIT do coder local

Desenvolvimento autorizado após a [investigação histórica](2026-09-02-investigacao-read-edit-replan.md).
Branch dev; HEAD inicial `154089f38b63f62718aa28fba9679f47fb437320` (= origin/dev).
HEAD final: commit atômico que contém este registro. Publicação autorizada: FF somente
origin/dev. main permanece `99bec54`; branch histórica permanece `1ee1921`.

## Lacuna e decisão

Antes, ServedRead possuía path, hash, slice numerado e proveniência somente em
memória. O JSON EDIT e before também eram efêmeros. applyEditOperations validava
hash, ocorrências e sobreposição, mas a exceção guardava apenas path/contagem.
O repair recebia feedback do gate sem transcript persistido. A evidência do coder
preservava duração/desfecho, não a sequência de operações.

Agora o canal existente onCoderObserved carrega transcripts opcionais. A mesma
RPC `record_host_observed_coder_evidence` grava o mesmo evento
`host_observed_coder_evidence_recorded`, uma vez por attempt, com todas as chamadas
iniciais/de reparo agregadas. Nenhuma tabela, RPC, enum, migration ou tipos SQL novos:
a extensão é no JSON já suportado. Validação do novo conteúdo e leitura tipada no
core (`coder-transcript.ts`); a RPC mantém sua régua anterior de envelope, owner,
attempt, versão e idempotência. Não alegar que o SQL valida o sub-schema novo.

## Schema e correlação

`evidence.attemptId` + `transcripts[].call` + `entries[].step` identificam a operação.
Cada transcript tem schemaVersion=1, call (0 inicial), previousCall, gateFingerprint,
diffFingerprint, termination e truncated. Cada entrada tem round do protocolo,
phase (`read`, `edit`, `application`), path, operation, readHash, expectedHash,
fingerprint/normalizedFingerprint SHA-256, length (unidades UTF-16), prévia structure,
lines, clipped, rawMatchCount, matchCount, result, readRefs e anchorReadRefs.

- READ: deriva de ServedRead, preserva números efetivos de linhas, fingerprint do
  slice servido e hash do arquivo. Não guarda busca nem conteúdo literal.
- EDIT: fingerprint/comprimento/estrutura do before (ou anchor de insert), hash
  esperado e hash do snapshot atual; readRefs aponta READs disponíveis do mesmo
  arquivo/hash. anchorReadRefs restringe aos trechos contíguos servidos que contêm a
  âncora sob o comparador vigente. Isso não afirma qual leitura o modelo usou.
- Application: operationStep aponta a entrada EDIT. applied somente após writeChangeSet
  concluir; batch_failed indica recusa anterior à escrita; write_failed indica que
  o lote não concluiu (pode ter escrito parcialmente antes do rollback do executor).
- Repair: call N → previousCall N−1. gateFingerprint é SHA-256 do JSON do failedGate
  host (label, command, exitCode, timedOut, cancelled, nessa ordem); diffFingerprint
  identifica o delta que motivou o reparo. Nenhuma mensagem do gate é persistida aqui.

append/create_file não têm âncora: fingerprints do vazio, length=0, contagens null,
result not_applicable. O resultado de aplicação é de aceitação/escrita do lote, não
uma prova funcional individual nem prova de ausência de rollback posterior.

## Classificação, privacidade e limites

| Fato observado | result |
|---|---|
| Hash esperado diverge do snapshot | stale_read |
| Hash igual; zero matches | invalid_anchor |
| Mais de um match | ambiguous_anchor |
| Zero matches crus; um com tolerância CRLF/LF vigente | normalized_match |
| Um match exato | exact_match |
| Lote escrito | applied |

Contagem reutiliza o matcher de produção; não muda suas regras. Sem fuzzy matching.
Estrutura guarda até 160 caracteres: espaços/pontuação delimitadora preservados,
demais caracteres substituídos por x. Não há before/after bruto, prompt, resposta
completa, busca ou arquivo integral persistido. Fingerprints permitem comparar um
candidato conhecido; não recuperam o conteúdo original. Até 256 entradas por chamada
(truncated explícito) e 16 chamadas no contrato de evidência. Experimento replace_anchor
opt-in não ganha tracing de aplicação nesta entrega; recorte é protocolo de produção.

Persistência continua advisory/fail-open e pós-volta, como a evidência existente:
exceções normais entregam transcript no finally; queda abrupta do processo antes da
persistência ou falha da RPC ainda pode perder a evidência. Não é journal transacional
por operação. Não altera o resultado da edição nem a autoridade de gates/Verifier.
Trecho servido significa produzido pelo host, não garantia de que o modelo o avaliou.
Metadados de tokenização, decisão interna do modelo e literal exato redigido continuam
ausentes; diferenças lexicais não podem sempre ser reconstruídas apenas por hashes.

## Provas e invariantes

- 86 testes web focados: protocolo, backend, transcript, persistência application.
  Incluem READ→EDIT→applied, stale, zero, múltiplos matches, CRLF/LF, erro de escrita,
  privacidade, referências inválidas e agregação de reparo falho ligado ao gate.
- 1 teste de integração do executor em git temporário confirma que a evidência
  atravessa exceção do backend até onCoderObserved.
- 21 testes core da evidência legada e suas projeções.
- 20 pgTAP: RPC existente preserva transcript e mantém replay/correlação/owner.
  Runner `supabase test db` não montou helpers/routing.inc; rodado o mesmo SQL com
  include expandido via psql, ON_ERROR_STOP, verificando os 20 `ok`, e ROLLBACK.
- Typecheck de todos os workspaces e git diff --check.

Nenhuma nova attempt/replan do PIN-02, nenhum modelo/Resident Host acionado, nenhum
budget alterado, nenhum PIN-03. Sem mutação dos itens/diagnóstico histórico. Provas DB
usam apenas fixtures transacionais com rollback. O before histórico não foi inferido.
Notas locais da investigação anterior incorporadas ao commit para preservar o handoff.
Artefatos locais do operador preservados. Próxima retomada: revisar esta evidência
numa futura execução separadamente autorizada; esta sessão não a autoriza nem a cria.
