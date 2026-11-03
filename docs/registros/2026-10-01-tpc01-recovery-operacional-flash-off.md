# 2026-10-01 — Recovery operacional do TPC-01 com flash-attention desligado

- Tipo: preparação operacional; branch dev; HEAD inicial/final 90cd081; origin/dev 90cd081; origin/main 99bec54. Sem commits novos.
- Pedido humano: retomar o recovery successor governado do TPC-01, mesmo qwen3-coder local com flash-attention desligado, preservando predecessor.
- Após reboot Docker/Supabase e Ollama estavam parados. Docker Desktop iniciado e Supabase existente retomado por start com serviços auxiliares excluídos, sem reset, rotação ou alteração de schema.
- Ollama 0.32.15 iniciado em processo com OLLAMA_FLASH_ATTENTION=0. Log de arranque confirma false; GPU RTX 5060 Ti, driver 13.4. Nenhuma nova probe ou chamada de inferência.
- Banco confirmou predecessor 25c2c047-b1f3-40b6-8362-999aa0809a2b failed, proposal v2, uma execution_started/attempt 107997e2-ae41-469d-bbe0-c887658c7285 e ausência de successor.
- Recovery OPERACIONAL via RPC canônica propose_recovery_successor, identidade residente autenticada, sem service_role. Não classificado como defeito de harness: não houve fix de harness para o crash CUDA.
- Chave fixa de idempotência 25c2c047-b1f3-50b6-8362-999aa0809a2b; sequência 1; lineage 5204c6eb-b050-474d-aee0-6f4fe94fdd68.
- Successor 11a4ec12-506c-453a-9032-5ed8128590d7 em proposed v1, zero attempts. Intent/proposal idênticos à fonte; comparação integral do predecessor antes/depois confirmou preservação.
- Preservados: dois arquivos cli/args.ts e cli/args.test.ts; quatro aceites; gate focal; base f94bc5a2dc8076be40471d5f7810d81518cb8bfa; ollama/qwen3-coder:latest; max_attempts=1, max_duration_minutes=30; required_fail_closed; canonical_provenance TPC-01.
- Arquivos locais preexistentes preservados. Scratch operacional em apps/web/scripts/_session/tpc01-runtime-recovery-once.ts, não destinado a commit. Logs do arranque no diretório work da conversa Codex.
- Sem aprovação/execução do successor, compute pago, authority/reservation, inferência, integração, push, merge ou deploy.
- O plano 008 originalmente vedava successor nesta prova. O pedido humano de 2026-10-01 autorizou explicitamente este recovery operacional único; registro histórico e predecessor permanecem preservados.

## Próximo ponto exato

Aprovação separada do successor proposto 11a4ec12; depois preparação canônica e uma execução local direcionada, com Router/on-demand/pago desligados e verificação de OLLAMA_FLASH_ATTENTION=false no processo ativo. Parar em review/terminal. Não criar outro successor ou retry automaticamente. Aceite e integração permanecem etapas separadas.
