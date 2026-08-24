# Backlog Proposal V0 — revisão natural E2E

- **Data / tipo:** 2026-08-24 — prova viva pela UI real.
- **Branch:** `dev`.
- **HEAD inicial:** `58bde65828c4e6f548a8e3243a2df219d25a1af1`.
- **Resultado:** `BACKLOG_PROPOSAL_NATURAL_REVISION_V0_E2E = PASS`.

A mensagem humana estruturada de revisão foi enviada uma vez pela UI real. O
host a classificou como revisão da única backlog proposal pendente, registrou
`changes_requested` na V1 `9dc0b976-030b-4c77-8001-934544042814` e criou a V2
`a76c5acf-3e6f-41d9-a8b4-170d51be2d13`, ligada por `supersedes_id`, sob a mesma
decisão ratificada `1dedfd5f-0f19-4e8a-8ac5-fcc54a304fbb` versão 1.

A V2 permaneceu `awaiting_confirmation` e decompôs a restrição humana em três
propostas técnicas do sistema: política local-first por capacidade/custo, gate
humano antes de compute pago e auditoria de autorização/custo. A proveniência
liga tanto o evento humano quanto a derivação do sistema à mensagem
`6732650a-8e00-4f71-8b41-335800c1d58a`. Não foram incorporados como preferência
humana cloud sem custo, acesso a arquivos locais ou melhoria genérica de código.

O caminho foi determinístico no host e não chamou provider externo. A única
linha nova em `ai_conversations` (`199 → 200`) é a própria mensagem humana usada
como fonte; nenhuma resposta de chat comum foi persistida. Contagens antes/depois:
propostas `1 → 2`, eventos de proposta `1 → 3`, materializações `0 → 0`,
`work_items/work_events/work_focus` `60/601/2 → 60/601/2`. Assim, nenhum work
item, approval, execution, Supervisor ou coder foi acionado.

**Fronteira humana:** a V2 não foi confirmada nem materializada. O próximo ponto
exato é sua revisão humana; somente uma confirmação posterior e inequívoca pode
autorizar a materialização.

