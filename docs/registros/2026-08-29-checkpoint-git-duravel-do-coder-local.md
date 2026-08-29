# Checkpoint Git durável do coder local

- **Data/tipo:** 2026-08-29 — desenvolvimento + reconciliação de prova viva.
- **Objetivo:** retomar o successor `f7d50d04…`, fechar `no_progress` e avançar
  até a primeira barreira real seguinte do Dev Local V1.
- **Branch / HEAD inicial:** `dev` / `50b929d`.
- **HEAD final:** preenchido pelo commit que inclui este registro.

## Estado real reconciliado

- O código já classificava `ollama_no_effective_edits` como `no_progress`.
- O banco autoritativo já continha a autorização de retry e a attempt 2
  `fb79667c-dc13-4122-b094-1c3be10ce2fc`, anteriores a esta sessão.
- A attempt 2 produziu edit, falhou no mesmo gate e terminou novamente em
  `ollama_no_effective_edits`; o successor ficou `failed`, 2/2, sem re-gate,
  Verifier ou `result_submitted`.
- A repetição é `no_progress/decompose`; nenhuma attempt adicional foi criada.

## Bug corrigido

O checkpoint persistido referenciava `anima-work/<attempt>`, mas o executor só
commitava depois dos gates. Quando o repair falhava, restaurava ao SHA-base e
descartava a worktree; a branch preservada não continha o edit anunciado.

Agora o executor:

- commita o estado do checkpoint antes do primeiro gate;
- calcula arquivos/diff/numstat sempre contra o SHA-base autorizado;
- restaura um repair falho ao commit durável do checkpoint;
- usa esse SHA como handoff final quando não existe commit posterior.

O teste novo escreve um edit inicial quebrado, faz o repair escrever estado
parcial e lançar, e prova que a branch preserva somente o edit inicial em um
commit. Os testes preexistentes continuam provando repair bem-sucedido.

## Gates e evidências

- focados: worktree + executor, 66/66; recovery core/web, 47/47;
- typecheck: cinco workspaces, verde;
- testes amplos: mobile 51/51; web 1.000/1.000; core 1.193/1.193;
  Supabase 9/9 (2 skipped preexistentes);
- build web: verde;
- `git diff --check`: verde (somente avisos CRLF do ambiente).
- warnings `act(...)` de componentes React permanecem ruído preexistente, sem
  falha de suíte.

## Segurança e efeitos externos

- Nenhum item, attempt, evento, claim ou lineage foi inserido/alterado nesta
  sessão; banco foi somente consultado para reconciliação.
- Nenhum gate foi reduzido; terminal falho continua falho.
- Nenhum reset, limpeza de `.worktrees/`, merge, PR, deploy ou alteração de
  `origin/main`.
- Ollama e Docker/Supabase locais foram iniciados para a reconciliação.

## Próximo ponto exato

Materializar somente sob governança uma decomposição baseada no no-progress
repetido. Na próxima prova real autorizada, confirmar que qualquer terminal após
checkpoint deixa a branch e o diff retomáveis; depois continuar pela primeira
barreira entre repair efetivo, re-gate, Verifier e review.

## Versionamento e publicação

- Commit local: `d15bcd6` — `Preserve o checkpoint Git do coder local`.
- O `git push origin dev` não foi executado: `origin` aponta para o repositório
  público `GeanPfefer/anima`, e a publicação dos dez commits locais exige
  confirmação explícita desse destino público ou troca para remoto privado.
