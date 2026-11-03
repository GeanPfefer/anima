# Investigação — `POST /api/ai/generate-insight` chamado 2× após o login (2026-10-14)

Append-only. Somente leitura (código, banco local, logs do servidor de dev). Nenhuma chamada repetida; nenhuma credencial lida ou divulgada.

## Fatos
- Origem: `InsightCard.tsx` (client) dispara `fetch('/api/ai/generate-insight', {method:'POST'})` num `useEffect` com `[]` quando `shouldTrigger` (calculado em `home/page.tsx`: nenhum insight não dispensado e ≥5 `xp_records` desde o último).
- Provedor: a rota chama **somente Ollama local** (`OLLAMA_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=qwen2.5:14b`). Não há OpenAI nem provedor pago nesse caminho.
- Nesta sessão não havia Ollama escutando em 11434 e nenhum insight foi gravado hoje: as duas chamadas retornaram 200 em ~770 ms com `skipped` (o `fetch` falha ⇒ `reason:'erro'`). **Nenhuma chamada externa real e nenhum custo monetário.**
- Por que 2×: o dev usa React StrictMode (padrão do Next 15 no dev), que executa efeitos duas vezes; as duas requisições saíram em paralelo (logs: 766 ms e 776 ms). Em produção seria 1×, mas o padrão continua sem proteção.
- Deduplicação/concorrência: **nenhuma** — sem lock, sem chave de idempotência, sem unique no banco; a guarda "insight recente <3 dias" e a contagem de novas entradas são lidas ANTES do insert. Há evidência histórica do dano: 2 insights do mesmo usuário gerados em 2026-08-03 22:49:30,230 e 22:49:31,578 (1,3 s de intervalo), ambos já dispensados.
- Cache: só o próprio estado do cliente; nenhum cache no servidor.

## Problemas reais (registrados separadamente; não corrigidos)
1. (Média) Corrida: chamadas concorrentes podem inserir insights duplicados (já ocorreu em 08-03).
2. (Baixa/Média) O gatilho reexecuta a cada visita à home enquanto não houver insight ativo e a chamada falhar ou for `skipped` (ex.: Ollama fora do ar): custo de DB e latência repetidos, e até 45 s de espera quando o Ollama está lento.
3. (Média, governança) O caminho chama o modelo direto, fora do Router/governança de compute e sem registro de custo/uso; hoje é local e gratuito, mas qualquer troca de provedor passaria sem os controles do Anima.
4. (Baixa) `shouldTrigger` e a rota usam critérios diferentes (não dispensado × qualquer insight <3 dias), gerando disparos que a rota recusa.

## Comportamento esperado × acidental
Disparo por efeito no carregamento: esperado. Duplicação 2×: acidental (StrictMode no dev + ausência de idempotência). Sem custo, sem chamada externa.

## Correção mínima sugerida (não executada)
Idempotência no servidor (índice único parcial por janela ou advisory lock por usuário + recheck no insert), `useRef` guard no cliente, alinhar critérios do gatilho, e rotear pelo mecanismo de compute governado se um dia o provedor deixar de ser local. Exige migration (se índice) e autorização própria.
