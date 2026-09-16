# Chat Dev com provider consistente

- **Data/tipo:** 2026-09-09 — desenvolvimento e prova.
- **Objetivo:** impedir que um turno iniciado com GPT use silenciosamente o provider local em qualquer subetapa.
- **Branch:** `dev`.
- **HEAD inicial/final:** `d783a5dc495da692eb7097f7c7252bb5ba074e51` / mesmo HEAD (sem commit nesta sessão).
- **WIP preservado:** mudanças preexistentes de CLI, RunPod, orquestração, migrations e registros não foram alteradas por esta correção, exceto o append no PRD já sujo exigido pelo roteador operacional.

## Causa e correção

- A UI persistia o seletor em `localStorage` e enviava `provider`, mas o Dev forçava `openai` no payload.
- `streamChatProvider` convertia recusa da admissão OpenAI em chamada Ollama.
- O planner configurado repetia o fallback OpenAI → Ollama; o Project Advisor reutilizava a mesma camada no turno seguinte.
- O payload agora preserva a seleção explícita também no Dev; a route cria o planner correspondente ao provider efetivo do request.
- Fallback cruzado foi removido. GPT falha como OpenAI; Local usa somente Ollama.
- A seleção explícita de GPT admite apenas consumidores interativos `chat` e `planner`, correlacionados ao usuário; coder e compute autônomo continuam fora desse envelope.
- Logs sanitizados registram provider pedido/efetivo, fase e ausência de fallback, sem segredo ou conteúdo pessoal.

## Provas

- Gate focal: 6 suites, 64 testes, todos verdes (`ChatClient`, chat provider, admissão interativa, planner selecionável, planner e Project Advisor).
- Cobertura: primeiro e segundo turno Dev com GPT; subetapa planner; ausência de fallback; Local explícito; erro GPT identificado como OpenAI.
- UI real em `http://localhost:3000/chat`: GPT selecionado retornou exatamente `PROVA GPT OK` pela OpenAI.
- Segunda instância limpa em `http://localhost:3001/chat` confirmou que a ausência do botão Dev é da autorização da conta atualmente autenticada, não cache/processo antigo.
- Typecheck web não ficou verde por erro preexistente fora do patch em `apps/web/lib/work-orchestration/autonomous-backlog-deps.ts:198` (`null` não atribuível a `string`).
- Flake conhecido dos testes: fixture do `ChatClient` reutiliza `X-Source-Message-Id: u1` e produz warnings React de chave duplicada; suites permanecem verdes e o warning não foi introduzido na aplicação.

## Efeitos e limites

- Uma mensagem de prova não sensível foi enviada pelo chat local à OpenAI, conforme o seletor GPT.
- Uma segunda instância local do Next foi iniciada na porta 3001; nenhum deploy, push, PR, merge, migration, RunPod ou alteração em `origin/main` ocorreu.
- A prova Dev completa na UI ficou limitada porque a conta autenticada no navegador não pertence ao allowlist `ANIMA_DEVELOPMENT_CHAT_USER_IDS`; o mesmo fluxo foi coberto na regressão de componente, enquanto a chamada GPT real foi provada na UI.
- Próxima retomada exata: entrar com uma conta do allowlist e repetir na UI os dois prompts do cenário; o código não requer nova mudança conhecida.
