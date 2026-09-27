# Identidade canônica de gate no recovery evidence

- **Data/tipo:** 2026-09-27 — desenvolvimento + prova viva read-only.
- **Objetivo:** corrigir o defeito de contrato que usava a representação sanitizada do comando como identidade de gate.
- **Branch:** `dev`.
- **HEAD inicial:** `73b37f768c1a2902fbeec2f33745b89ecb7080fd`.
- **HEAD final:** o commit local que contém este registro e a implementação abaixo.

## Mudanças e decisões

- `gate-identity.ts` deriva SHA-256 de JSON determinístico v1 com `kind: test`, programa lowercase sem `.cmd` e argumentos tokenizados com barras normalizadas. O parser/command policy autorizado precede a derivação; path absoluto volátil e shell não ganham identidade por inferência.
- `gateIdentity` é anexado ao validation command antes da inferência, passa ao transcript e é persistido explicitamente em cada nova command observation. O comando raw continua autoridade de execução; `command` persistido continua display bounded/redigido.
- O seletor compara fingerprints. Para eventos antigos sem o campo, não há rewrite/backfill: ele sanitiza o gate atual e aceita igualdade textual exata somente quando o display corresponde a uma única identidade atual. Dois gates que colapsem no mesmo `app<path>` tornam o fallback ambíguo e são recusados.
- O resumo preserva genericamente a primeira causa JavaScript tipada (`ReferenceError`, `TypeError`, etc.) além do tail; não conhece `Response`, teste ou rota específicos.
- `MAX_ITEMS=4`, escopo exato dos arquivos alterados, redaction, referências rastreáveis e exclusão de assistant thought/transcript livre permanecem invariantes.

## Provas

- Unit/regressão: comando original versus sanitizado pela mesma identidade; path redigido; restart; gate diferente; argumento diferente; FAIL→PASS; máximo quatro; transcript/raciocínio ausentes; legado único aceito e ambíguo recusado; caso `c284f09c`.
- Reconstrução read-only da função de produção para item `843669bd-44f6-4d36-8129-19db12cb573c`: dois itens selecionados, `truncated=false`. O item ancestral `c284f09c-dc43-4e4e-a8a1-592f3fadd561`/evento `5ebf4d94-e6e5-40f5-b6ac-3e0a8a734f44` recebeu fingerprint `92e2041a71e3e34bbad9f0401370dee19460cac4933d384ef2202e2d8330977c`, `ReferenceError: Response is not defined`, mudança em `route.test.ts` e o mesmo gate posteriormente verde. A seleção não contém regra para `Response`.
- Focais/vizinhas: 6 suítes, 226 testes verdes.
- Core: 100 suítes, 2.035 testes verdes.
- Web: 145 suítes, 1.812 testes verdes; warnings React/CRLF já conhecidos, sem falha.
- `npm.cmd run typecheck`: cinco workspaces verdes.
- `npm.cmd run build --workspace=@anima/web`: Next build verde, 66 páginas.
- `git diff --check`: verde.

## Segurança, efeitos e retomada

- Nenhuma OpenAI attempt, retry, nova paid authority, reservation, compute, push, merge, deploy ou alteração de `origin/main`. B1 permaneceu congelado; custo desta sessão: **US$0**.
- A prova viva foi somente leitura. O script scratch criado para ela foi removido; `.worktrees/`, `apps/web/scripts/_session/` e `watch4-sensors.txt` preexistentes permaneceram preservados.
- Próximo passo autorizado pelo mandato: derivar recovery governada da falha `98402f85-833b-40c0-84c3-1bba2954f316`, preservar apenas `route.ts` e `route.test.ts` e os três gates existentes, registrar preferência `provider_api/openai/gpt-5.6-sol`, preparar autonomous e parar em `waiting_for_human_authorization`. Não autorizar compute.

## Checkpoint operacional final

- Commit da implementação: `6580be262594e00b99ae5bb53e5db68445a412b4` (`Estabilize a identidade dos gates de recovery`).
- Successor: `f6c326b1-955c-4bbe-ac1d-cac3857ce40a`; recovery `ccbba04d-9ec5-459f-841b-8b86c517cee0`; lineage `1955df37-0f74-4d73-90c8-5713773b91b0`; source attempt `98402f85-833b-40c0-84c3-1bba2954f316`.
- A proposta v1 preserva exatamente `apps/web/app/api/dev-readiness/route.ts` e `route.test.ts` e os gates focal, typecheck web e Next build. Está `approved`, preparada para autonomous, zero attempts, preferência `provider_api/openai/gpt-5.6-sol`.
- Uma iteração bounded do Resident Host (`maxIterations=1`) tocou apenas o successor e terminou `turn_not_executable/paid_authorization_required`. Router em `waiting_for_human_authorization` desde `2026-09-27T17:01:10.421Z`.
- Nenhuma paid authority, reservation, provider call, retry ou compute. **US$0**. Parar aqui; o próximo ato é exclusivamente humano e não foi executado.
