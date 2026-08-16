# 2026-08-16 — Modo de convivência (baixa contenção) + direção do Resource Governor

**Tipo:** investigação + documentação (trabalho deliberadamente LOW/MEDIUM — usuário jogando
no mesmo PC).

**Objetivo:** operar sob **baixa contenção de recursos** (o usuário pediu para preservar
capacidade do PC para um jogo) e, em vez de forçar workloads pesados, aproveitar a necessidade
como **oportunidade arquitetural**: documentar a direção de um **Resource Governor / orçamento de
execução por recursos da máquina**. Continuação de
[2026-08-16-independencia-de-gates](2026-08-16-independencia-de-gates.md).

**Branch:** `claude/integration-application-layer`.
**HEAD inicial:** `94eb99e`. **HEAD final:** este commit documental.
**origin/main:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta, SEM push.**

## Regra de operação adotada nesta sessão

Classificação interna de cada operação antes de executá-la: **LOW** (leitura, busca, edição,
diff, git local, testes muito focados), **MEDIUM** (typecheck pequeno, suíte focada), **HIGH**
(full suites, builds, pgTAP completo, Docker pesado, campanhas, modelos locais, paralelismo
amplo). LOW/MEDIUM prosseguem; **HIGH é adiado** enquanto houver trabalho LOW/MEDIUM útil. Se
um HIGH for necessário para provar um recorte, o trabalho **para e avisa** — nunca afrouxa o
gate nem finge que passou. Esta sessão foi inteiramente LOW.

## Telemetria (medida barata) e ação tomada

Snapshot leve do host (`docker ps`, `ollama ps`, `Get-CimInstance Win32_OperatingSystem`,
`Get-Process`):

- **RAM:** 15,9 GB total, ~4,6 GB livre (≈11,3 GB em uso) — pressão de memória moderada.
- **Maior consumidor de dev:** `vmmem` (VM do WSL2/Docker, hospedando os 8 contêineres do
  Supabase que EU havia iniciado numa sessão anterior) — **~1,2 GB**.
- **Jogo:** `Spider-Man` ativo (~0,94 GB) — uso interativo confirmado.
- **Ollama:** nenhum modelo carregado (sem pressão de GPU/VRAM atribuível ao Anima).

**Ação (LOW, reversível):** `supabase stop` — liberou ~1,2 GB de RAM para o jogo. Os dados
permanecem no volume Docker (`supabase start` os restaura). A parada foi escolhida porque o
trabalho desta sessão é **documental** e não precisa do banco; a reinicialização pertence à
próxima janela de validação HIGH autorizada.

**Achado arquitetural:** em repouso, o gargalo dominante do modo autônomo local é o
**Docker/Supabase (RAM via WSL2)**, não os modelos locais. Um Resource Governor deveria tratar
"subir Supabase" como custo HIGH de RAM e liberá-lo quando ocioso.

## Direção documentada (não implementada)

`docs/arquitetura/orquestracao-de-trabalho.md` §"Governança de recursos da máquina — Resource
Governor (direção)": estende a **reserva interativa** do INTEL-04 (que reserva *tempo*) para os
**recursos físicos** (CPU/RAM/disco/GPU); generaliza o "sob mandato" do Marco 007 e os "recursos
locais sob permissão" do Marco 004. Princípio central: **não** aplicar thresholds fixos cegamente,
e sim **aprender o custo real** (`tipo de tarefa + repo + comando + histórico → previsão de
CPU/RAM/I/O/GPU/duração`) e comparar com `recursos atuais + reserva do usuário → pode executar
agora?`. Through-line: o `durationMs` já capturado na evidência de gate observada pelo host é uma
semente de custo; a medição de pressão é barata; a reserva não concede autoridade nova (decide
**quando/como**, não **se pode**). Heurística V0 grosseira = LOW/MEDIUM/HIGH, provisória até a
predição aprendida.

**Deliberadamente NÃO feito:** implementar o governor, coletar telemetria persistente, treinar
predição, criar agendador — tudo exigiria recorte próprio e autorização. Não se criou **Marco**
novo: a direção é proporcional a uma seção de arquitetura viva + este registro, e se apoia nos
Marcos 004/007 e no INTEL-04 existentes.

## Invariantes de segurança preservadas

- origin/main intacta; **sem push, PR, merge, deploy, efeito externo, credencial real**.
- `.worktrees/`, worktrees, `.claude/settings.local.json`, `apps/web/.env.local` preservados;
  nenhum `git clean`/reset destrutivo; nenhuma evidência apagada.
- `supabase stop` é **reversível** e não apaga dados (volumes preservados). Nenhum gate foi
  afrouxado; nenhuma validação foi removida — apenas **adiada** por contenção de recursos.
- Nenhuma política automática de maturidade; o Resource Governor é **direção**, não autoridade.

## Próximo ponto de retomada

Sob **máquina livre** (janela HIGH autorizada), retomar o eixo de evidência/verificação ou
implementar o Resource Governor V0 é elegível — mas ambos exigem execução HIGH (pgTAP, suítes,
possivelmente Ollama) e/ou nova autorização de recorte. Enquanto o modo de convivência estiver
ativo, seguir com trabalho LOW/MEDIUM (investigação, documentação, testes muito focados). Para
retomar validação pesada: `supabase start` (recria os contêineres a partir dos volumes) antes de
pgTAP.
