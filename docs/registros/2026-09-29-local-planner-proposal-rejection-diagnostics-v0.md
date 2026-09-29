# Local Planner — diagnóstico de rejeição de proposal V0

**Data:** 2026-09-29

**Tipo:** desenvolvimento e prova isolada

**Branch:** `dev`
**HEAD inicial:** `42d567f` (`origin/dev` igual; `origin/main=99bec54`)

## Causa e decisão

`parseProposal` condensava toda falha estrutural em `null`. O adapter local combinava
`parsed && includedScopeAnchoredInProject(...)` numa única condição e, em qualquer falha,
respondia como se o problema fosse ancoragem de `included_scope`. Assim, gate fora da allowlist,
`claim_kind`, `max_attempts`, cobertura, tipo ou campo obrigatório inválidos recebiam uma causa
incorreta e induziam o modelo a repetir o mesmo submit.

A validação compartilhada ganhou um resultado discriminado que preserva exatamente a semântica
anterior: sucesso carrega a proposal normalizada; falha carrega `proposal_invalid`, `field`,
`rule` e mensagem curta. `parseProposal` permanece como fachada compatível (`proposal | null`)
sobre essa mesma fonte, evitando duas políticas.

Depois de uma proposal estruturalmente válida, a checagem de topologia pode produzir apenas
`included_scope_not_anchored`, com até quatro paths truncados defensivamente e contagem dos
demais. O tool result local usa `{ok:false,error:{code,message,details},guidance}`. Não foi criado
logging global porque o adapter local não possuía canal de auditoria apropriado.

## Validações distinguíveis

- JSON/objeto raiz;
- campos de texto e listas obrigatórias;
- máximo e segurança de `included_scope`;
- comando principal e comandos adicionais fora da allowlist;
- `claim_kind` principal/adicional;
- `target_paths` não exatos, inseguros, repetidos ou acima do limite;
- `max_attempts` fora de 1–3;
- `covers` desconhecido ou `expected_effects` sem cobertura;
- estrutura e limite de `additional_validations`;
- proposal válida cujo escopo não está ancorado na topologia real.

## Provas e invariantes

- fixture ILUSTRATIVA inspirada no submit do `qwen2.5-coder:14b` (escopo real em
  `apps/web/cli`, cobertura divergente) identifica `validation_covers/unknown_criterion`, não
  ancoragem. O payload REAL da 4ª chamada não foi capturado (o observador truncou os argumentos),
  então a causa exata daquela rejeição continua desconhecida; a fixture prova o mecanismo, não o
  diagnóstico retroativo;
- 7 suítes relacionadas ao project planner: 148/148 PASS (Codex) → 152/152 PASS após a recuperação;
- consumidor externo `work-proposal-readiness`: 4/4 PASS;
- `npm.cmd run typecheck --workspace=apps/web`: PASS;
- `git diff --check`: PASS;
- nenhum Ollama/OpenAI chamado; nenhum logging sensível, banco, materializer, attempt ou
  authority tocado;
- TPC-01 permanece `not_started`; projeção permanece 33 elegíveis / 0 positivos;
- `origin/main` permaneceu em `99bec54`.

## Recuperação (Claude, mesma data)

O Codex atingiu o limite de uso com a unidade em WIP não commitado (5 arquivos rastreados + este
registro). A recuperação preservou integralmente o WIP e só revisou: equivalência semântica
confirmada campo a campo com o `parseProposal` anterior (cada condição reaparece com a mesma
regra; para `target_paths` e `additional_validations` o diagnóstico roda antes e
`parseTargetPaths`/`parseAdditionalValidations` seguem como verificação final, então uma
divergência só pode recusar, nunca aceitar);
`unanchoredIncludedScopePaths` é a negação exata, ramo a ramo, da regra de ancoragem.
Acréscimos: 4 casos de teste (`included_scope` inseguro, `target_paths` não exato, gate adicional
fora da allowlist, JSON inválido) e a correção da leitura da fixture do 14b acima. Nenhuma chamada
a Ollama/OpenAI; TPC-01 não materializado.

## Próximo ponto exato

Após integrar esta unidade em `origin/dev`, uma única materialização governada separada com
`qwen2.5-coder:14b @ 16k` pode testar se o feedback específico permite autocorreção, mantendo
a parada humana antes de qualquer execução.
