# Evolution Reconciliation V6 — 2026-10-21

Append-only. Tipo: reconciliação de dados do Capability Registry + registro de prova de laboratório. Branch `claude/evolution-v6` (worktree `C:\Users\GeanTeco\anima-work-evo-v6`), base `e2fa7a8949f41a4a934b77d412fcc42158f5e891` (= `origin/dev`). `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta. **Candidato para revisão humana; não integrado nem publicado.** O candidato é o HEAD do branch.

Antecede: [`2026-10-14-evolution-reconciliation-v5-attempt-b557509b.md`](2026-10-14-evolution-reconciliation-v5-attempt-b557509b.md) e a auditoria read-only de 2026-10-21 (diagnóstico Evolution + ai-memory, sem alteração de arquivos).

## Decisões do operador (mandato desta etapa)

1. Baseline V6 = `e2fa7a8`, publicado em 2026-10-20, **sem** o UX I2 (`claude/ux-trabalhos-2`, `34ccf85`), que segue preservado e não integrado.
2. Registrar a prova Claude → Codex → Claude de `anima-labs` (2026-10-03) só com identificadores, hashes, resultados e evidência sanitizada.
3. Reconhecê-la como prova operacional **de laboratório**: não promove `memory.cross-harness` e não afirma compatibilidade com Codex WSL/L1.
4. Manter a distinção implementado × prova operacional × autonomia.
5. Nenhuma capacidade nova, nenhuma relação de dependência alterada.

## Escopo alterado

- `packages/core/src/capability-registry.ts` (dados: `EVOLUTION_BASELINE`, `history`, `proofRefs`, `frontier`; comentário de cabeçalho).
- `packages/core/src/capability-registry.test.ts` (testes do registry: baseline e janela "recente" migram da V4/V5 para a V6; bloco novo da V6).
- `apps/web/app/(app)/evolution/_components/EvolutionClient.test.tsx` — **somente** a asserção do teste que fixava o texto da baseline e dois nós da lente "Evolução recente" (consequência direta da troca de baseline; nenhum código de UI mudou).
- Este registro.

Fora do escopo e intocado: UI `/evolution`, executores, L1/E2, banco, migrations, ACLs, credenciais, hooks, MCP, ai-memory (nada instalado/atualizado), origin/main, UX I2, WIPs e worktrees.

## Nós atualizados (nenhuma maturity muda; 67 ids, distribuição 15/21/14/14/3 preservada)

Todas as entradas novas: `at: 2026-10-21`, `change: proof_added`, sem `from`/`to`. A data é a da reconciliação (mesma convenção da V5); os fatos descritos são anteriores e estão datados nas notas.

| Nó | Maturity | O que entrou | Natureza da prova |
|---|---|---|---|
| `memory.cross-harness` | implemented | Prova de laboratório do wrap `2e153ed` (abaixo); frontier: não suportado no Codex WSL/L1, versão fixada 2.4.1 | **Laboratório** (Windows nativo), não residente |
| `agency.external-harness` | implemented | E2 `d32a902`, ACL do CodexHome `1d6a7bb`, L1 `901a774`, registro L1; frontier: provas só em laboratório, ai-memory recusado no WSL, sem troca automática por quota | **Laboratório / código+testes** |
| `agency.isolated-workspace` | operational | A3 `a6ebfa6`, isolamento de credenciais do Host `eb1f3eb`, testes e doc; frontier: nada aplicado no residente | **Código+testes** |
| `governance.governed-integration` | implemented | Recibo `ff_only` do A1-v2 versionado (autorização 86819, `integration_completed` 86820, `ed586e53`→`3b8e1cbe`); `7d3cf0e`; `e2fa7a8` (projeção `integrated`); frontier ajustado: só UMA integração tem recibo versionado | **Residente** (uma ocasião) + leitura |
| `agency.supervised-self-development` | proven | A1-v2 (`499b6222`, A1_PASSED) e A2R1-PROOF (`38e39912`, fato 86832, PASS 15/14); `2888118`; frontier: `human_observed`, `unattended_verified` = 0 | **Residente** (duas ocasiões, supervisionadas) |
| `governance.authority` | proven | A2-0 R2 `921634d`/`7863c01` (Acceptance Mandate V1); frontier: migrations R2 não aplicadas no residente, grantor e `ANIMA_TRUSTED_REPO_ROOT` não provisionados, sem prova viva | **Laboratório** (banco descartável) |
| `interaction.web-interface` | operational | UX-TRABALHOS I1 `d72ddf5`, `e2fa7a8`, registro; frontier: I2 não incluído | **Código+testes**, leitura real read-only registrada no registro UX |
| `compute.subscription-availability` | projected | Só frontier: autoridade da quota de assinatura em aberto, sem leitura real, sem troca automática | — |

`EVOLUTION_BASELINE`: `{ commit: 'e2fa7a8', date: '2026-10-20', label: 'Evolution Reconciliation V6' }` (antes: `6226324`, 2026-10-07, V4). Efeito: a lente "Evolução recente" passa a listar apenas as entradas V6.

### Laboratório × residente (resumo explícito)

- **Residente (ledger vivo), por registro versionado:** A1-v2 (`2026-10-15-...`), A2R1-PROOF (`2026-10-17-a2-0-r1-...`), migrations R1 aplicadas após backup restic verificado (conforme o registro R1).
- **Laboratório / banco descartável:** A2-0 R2 (pgTAP 175/175, E2E 11/11), E2, L1 (lab `G:\anima-iso-lab\L1`), ACL do CodexHome (réplicas fictícias), prova ai-memory abaixo.
- **Código e testes sem prova viva:** A3, isolamento de credenciais do Host, UX-TRABALHOS I1 (com leitura real somente-leitura).
- Este registro **não reverificou** o ledger nem o banco do residente: o estado do residente é o que os registros citados afirmam.

## Prova de laboratório: ai-memory, Claude → Codex → Claude (2026-10-03)

Origem (fora do Git): `G:\anima-labs\ai-memory-live-v1\evidence\` (`live-proof\` com 32 arquivos). **Nenhum prompt, transcrição, conteúdo de ledger, valor de canário ou segredo foi copiado para este registro.** Só ids, hashes e resultados.

### Configuração
- Wrapper do ANIMA em `2e153ed` (backends nativos, `ai-memory run --no-autowire --workspace anima --project anima --new|--workstream ...`); ai-memory **2.4.1**, exe sha256 `143ee3779828017de8b5f698e9269d3c61db7cd08902890ee60fb31f12312537` (zip oficial do POC: `9626bf35b211aa8cf24a501f90cc54a36dd26d31c24a43da3760258a4f50a295`); servidor loopback `127.0.0.1:49384`, `healthz=200`.
- Claude Code 2.1.286 (binário do app desktop), login por assinatura (relato do preflight: `claude.ai`, plano `pro`), modelo `claude-opus-5-5`. Codex via ChatGPT em `CODEX_HOME` isolado, executável fixo por shim `codex-no-daemon.exe` (sha256 `C05ABD027499BB4B7C310FCF6BEC6DC3F604F3AC10742B0A42DA2A1FA5563965`; sem modelo executado na validação do shim). Variáveis de API de modelo não definidas. Config global dos harnesses **inalterada** (`global-config-before/after` com o mesmo sha256 `04f30e6d032a6cd05d77dd469d4e33e5ad72b22ccbc93227d5b721a1fbf07cb6`).
- Fixture descartável `wt-xh` (branch `xh`, HEAD inicial `dc7ff15a1eea11741ca5af8b7feffa355a047435`, limpo). Codex em Windows nativo, `sandbox_mode=workspace-write`, `approval_policy=never` — **não** é o transporte WSL, nem L1, nem E2 (posteriores).

### Resultado
| Leg | Harness | Modo | Duração | Exit | Eventos salvos | sha256 do run |
|---|---|---|---|---|---|---|
| 1 | claude | `--new akita-baseline-xh-v1` | 20,8 s | 0 | 12 | `a3d5a9b36cef7d1f64f422cb041201f4182101a0c5d1f83104888cf621475838` |
| 2 | codex | `--workstream` (continue) | 49,4 s | 0 | 7 | `1989ecb6a3160f518e4a379945921b9dd7ed144f81143c31a0a9ba51976f63a5` |
| 3 | claude | `--workstream` (continue) | 17,2 s | 0 | 9 | `fbfc02f289ddce829fe2ac9c54ef2eba226559252d31fccc17c1ad8c68d794b0` |

- Workstream único `01a0ffbae6757c6390653b40ef10d533` (nome `akita-baseline-xh-v1`); sessões nativas: claude `747fed65-316f-49a5-ac57-5b3da9da41b5` (reutilizada no leg 3), codex `01a0ffbb-712c-7b11-9440-6cbb27be1217`. Runs gerenciados `01a0ffbae6757c6390653b568b6734e9` (claude), `01a0ffbb6f297303b9979dab59e378ae` (codex), `01a0ffbc67697c00acf1fa9b4b6c068a` (claude), todos `finished` com exit 0, leases sequenciais (`goma:9540`, `goma:22848`, `goma:28784`). Ledger de 28 eventos; cursores finais: claude 28, codex 19.
- Continuidade demonstrada por **dois canários sintéticos** (A plantado no leg 1, B plantado no leg 2): antes do leg 2 o canário A não existia no repositório e o canário B não existia antes do leg 3; os prompts congelados (sha256 `c432acb3…08d55`, `4095fa02…142e7`, `fde3f685…fee83`) não contêm nenhum dos dois; o inspetor do ledger encontra A e B nos eventos do Codex e do Claude de retorno. Isto mostra transferência de informação **pelo ai-memory**, não por prompt.
- Digests de evidência: `ai-memory-inspection.txt` `68a6229fbadb7db7db42bc9859d3ae1fe23b3ebc8fd0fb2057811655e465af26`; `prompts.sha256.json` `8a9e81a8def0c383c476ca6e297f558af5570561a9abf58784d066cadd2cfa7e`; `lab-manifest.txt` `43f6c6f0f5b7a01b51ce9a7a1980f67f06193c4d0f47f064406f1be2e5b3e32e`; `shim-validation.txt` `f4820e928b614bbf2b865a0d68b7cbb2e31ca11c7659468603980bb31c1e4227`; digest agregado dos 32 arquivos de `live-proof\` (sha256 da lista `sha256sum` ordenada): `87b7a526571f90b4be7823115bf35d89d810f6abcdadd2d872a75a4e89b9ba3d`.

### O que a prova NÃO mostra
- Não é prova no residente, nem em attempt governada: sem Verifier, gates do host, work item, claim ou ledger do ANIMA.
- Não cobre Codex WSL/L1/E2. No código atual o wrap é **recusado** no transporte WSL (`codex-cli-coder.ts`, "Codex WSL coder não suporta ai-memory wrap") e o Single-Item de assinatura o proíbe (`executor-selection.ts`). Compatibilidade com L1 não é afirmada; a colisão com a negação de `~/.codex`, a rede desligada e o `--ignore-user-config` é inferência, não testada.
- Não mede qualidade do código produzido: a fixture terminou com `src/a.js`, `src/b.js`, `src/c.js` não rastreados; não houve avaliação de gates. É uma prova de **continuidade de contexto**.
- O ledger do ai-memory guarda mensagens e argumentos de ferramentas em texto claro; o sanitizador só remove padrões que reconhece (risco já declarado no registry). Os canários hexadecimais aparecem no ledger por desenho do teste.
- Versão 2.4.1; o upstream publicou versões posteriores (relato externo lido em 2026-10-21, até 3.1.2) e a compatibilidade do wrap com elas **não foi testada**.
- Consumiu cota de assinatura dos dois harnesses na data da prova (efeito já realizado em 2026-10-03; nada foi executado nesta reconciliação).

## Bloqueios que permanecem (registrados em `frontier`)

1. **A2-0 R2:** migrations `20261017000000/1` não aplicadas no residente; grantor (`anima_mandate_grantor`) e `ANIMA_TRUSTED_REPO_ROOT` não provisionados; sem prova viva com item novo. Verificação do estado atual do banco fica para quem for aplicar (esta etapa não consultou o banco).
2. **ai-memory × Codex WSL/L1:** recusado por código; qualquer reabertura exige POC próprio e decisão humana, sem relaxar L1/E2.
3. **Autoridade da quota de assinatura:** aberta desde a Reuse Architecture V1; sem leitura de quota e sem seleção automática de agente quando a quota termina.
4. **Autonomia:** `unattended_verified` = 0; A1-v2 e A2R1-PROOF são `human_observed`; A2R1-PROOF segue em `review` sem aceite (D4).
5. **Aplicação de E2/L1/A3/isolamento de credenciais no residente:** nada consta como ativado (ACL real, `ANIMA_GATE_SANDBOX`).

## Verificações

Ver a seção final do relatório de entrega (testes focais do registry, suíte do Core, typecheck, teste da UI afetado pela baseline, integridade de referências). Resultados numéricos ficam no relatório da sessão e no resumo do commit; este registro não os repete para não envelhecer.

## Efeitos externos

Nenhum: sem banco, migrations, ACL, credenciais, hooks, MCP, instalação/atualização do ai-memory, attempt, compute pago, integração ou push. A leitura dos artefatos de `anima-labs` foi somente-leitura e sem abrir prompts ou transcrições.

## Próximo ponto de retomada

Revisão humana do candidato. Se aprovado: integração governada por `ff_only` (ato humano separado). Itens abertos por decisão humana: aplicação das migrations R2, escopo do ai-memory (sessões interativas × executores governados) e classe de autoridade da quota.
