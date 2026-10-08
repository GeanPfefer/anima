# Marco 009 — Resiliência por Substituição — Versatilidade Infinita

> 2026-10-07 · Marco append-only de visão. Registra um princípio e uma direção; **não** autoriza implementação nova.

## Princípio

**A continuidade pertence ao ANIMA, não às ferramentas que ele utiliza.**

Modelos, executores, harnesses, ambientes, sistemas operacionais e infraestrutura são
instrumentos substituíveis (Marco 005: providers são substituíveis; Anima é identidade
única). Uma falha numa ferramenta não deve significar, automaticamente, a interrupção da
capacidade quando existir uma alternativa **compatível, comprovada e autorizada**.

O ANIMA deve, ao longo do tempo, aprender a **descobrir, avaliar e selecionar**
alternativas para cada instrumento de que depende. A seleção deve considerar capacidade
real, saúde, compatibilidade, segurança, cotas, custos, disponibilidade e evidências —
nunca preferência, nome de marca ou otimismo.

## Limite inegociável

**A substituição nunca amplia autoridade e nunca contorna governança.** Trocar o
instrumento não altera o mandato: efeito permitido, escopo, orçamento, aprovação humana,
isolamento, verificação host-side e auditabilidade permanecem os da capacidade original.
Uma alternativa só é elegível se já tiver sido comprovada para a mesma classe de efeito e
estiver autorizada; a falha de uma ferramenta nunca é pretexto para promover outra.

## Evolução empírica

Problemas reais encontrados na operação devem gerar **conhecimento durável** (registros,
testes, diagnósticos) e orientar as prioridades. **Reutilizar solução comprovada antes de
construir nova.** Cada substituição bem-sucedida ou falha é evidência para a próxima decisão.

## Evidência que originou o marco

O Codex CLI nativo do Windows ficou bloqueado por uma falha de inicialização do sandbox;
o mesmo Codex, autenticado pela mesma assinatura, executou no Ubuntu 24.04 sob WSL2. Em
vez de interromper a capacidade de investigação, o ANIMA ganhou um **transporte opt-in**
(`investigation-v1` via `wsl.exe --exec`), preservando snapshot Git, verificação, sandbox
`read-only`, aprovação `never`, cancelamento e governança — a falha de um ambiente virou
uma alternativa comprovada, não uma exceção. Ver
[`docs/registros/2026-10-07-transporte-wsl-investigation.md`](../registros/2026-10-07-transporte-wsl-investigation.md).

## Linhas futuras de investigação (NÃO implementadas)

Registradas como direção, sem compromisso, sem backlog e sem autorização de código:

- descoberta e avaliação contínua de modelos, executores e harnesses alternativos;
- seleção dinâmica generalizada / roteador universal de executores;
- ambientes e sistemas operacionais alternativos (inclusive dual boot ou migração de SO);
- infraestrutura substituível além do que já existe (nós locais, Cloud Burst).

Qualquer uma delas exige plano próprio, evidência de necessidade e a mesma governança.

## O que este marco não faz

Não cria roteador, não altera seleção/elegibilidade existentes, não dá autoridade nova a
nenhum executor, não afrouxa a política de segurança (Marco 006) e não reclassifica
nenhuma decisão histórica.
