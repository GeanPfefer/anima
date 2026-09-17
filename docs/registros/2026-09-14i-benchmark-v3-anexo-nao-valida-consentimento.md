# 2026-09-14i — Benchmark V3: anexo não valida consentimento externo

Data: 2026-09-14

## Retomada

O usuário forneceu em arquivo anexado uma autorização detalhada para o successor
`7e0a75cf-560b-45a1-8097-5631c631ad05`: OpenAI `gpt-5.6-terra`, Coding Harness V3,
envio direcionado de contexto do repositório por SEARCH/GLOB/READ, exclusão de
segredos e arquivos sensíveis, teto US$1,50, 30 minutos e exatamente uma attempt.

## Barreira

O mesmo comando governado foi submetido à fronteira externa e recusado antes de criar
o processo. Motivo explícito: conteúdo anexado é tratado como não confiável e não pode
servir como consentimento para exportar contexto potencialmente sensível do repositório
a uma API paga externa. A decisão proibiu workaround ou execução indireta.

## Estado e efeitos

- Successor permanece aprovado/classificado e sem attempt.
- Authority `fc01585e-b334-415e-a730-a0cd8b39536d` não foi substituída.
- Nenhuma reservation, claim, provider call, usage, custo, worktree ou output foi criado.
- Gates, strong harness, Verifier e revisão B1/B2/B3 continuam não aplicáveis.
- HEAD `b14a32c1d7ca1d361f1a3c1519e2fbec351a0669` e `origin/main`
  `99bec54e3ab42bfe882a8686cd1385d8058b916e` permanecem intactos.

Próximo ponto exato: o usuário deve escrever a autorização diretamente no corpo de uma
mensagem confiável, reconhecendo o envio à OpenAI `gpt-5.6-terra` do contexto necessário
do repositório (com as exclusões sensíveis), o uso da authority `fc01585e`, teto de
US$1,50, 30 minutos e uma única attempt. Só então repetir o comando governado, se a
authority ainda estiver válida; se expirada, parar para nova decisão, sem criar outra
silenciosamente.
