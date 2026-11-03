# Inspeção visual autenticada — Autonomy Evidence V1 (2026-10-14)

Append-only. `dev` = `62d95fc4`. Somente leitura: nenhum código, dado, migration, work item, lease, commit, branch ou push. Servidor `npm run dev:web` (porta 3000) subido por mim; Supabase intocado. Sessão autenticada reaproveitada do próprio navegador do app (nenhuma credencial lida, digitada ou extraída).

## Método
Navegador embutido: desktop 1280x800 e mobile 375x812; DOM, computed styles, lentes, seleção, console, rede e log do servidor. Screenshots foram vistos inline na sessão (o navegador não grava arquivo); a evidência registrada é o DOM/JS.

## Números exibidos × canônico
Tela, leitura canônica (`readCapabilityEvolution`, mesma identidade/RLS) e SQL independente (outra implementação, `user_id` residente) coincidem:
- Histórico: 49 concluídos, 2 em review; atos humanos por item concluído média 2,78 (mín 2, máx 6); política média 0,63 (total 31); 31 concluídos com lease E0; leases 61 (0 ativos, 25 expirados, 36 revogados); attempts 155/71/88/0; classes 0 unattended verificado, 51 humano observado, 0 desconhecido, 0 insuficiente.
- 14 dias: 40 concluídos, 1 em review; média 2,80 (2–4); política 0,65 (26); 30 com lease; leases 53 (0/23/30); attempts 77/52/25/0; classes 0/41/0/0.
- `verdict` `unknown`; 0 `unattended_verified`; 0 fatos `execution_mode` reais (os 2 eventos com o texto são a proposta e a evidência de gate do próprio item, citando a palavra no escopo).
- Os números anteriores à integração (48/3) mudaram para 49/2 apenas porque o item V1 foi aceito.

## Achados
1. (Média, clareza) "Ciclos sem humano verificados: 0" não se distingue de "nenhum ciclo ocorreu sem humano": a nota exibida é "Operacional ≠ autônomo; ausência de evento não prova ausência de intervenção" (sobre maturidade/eventos). O motivo real — falta de prova positiva, pois o host não emite `execution_mode: unattended` — aparece só como a última limitação ("Nenhum fato de modo de execução registrado"), fora de vista. A linha também vem após a janela de histórico completo e parece pertencer só a ela.
2. (Média, posicionamento) O bloco fica ~615 px abaixo do topo do painel lateral (aside de 487 px com rolagem interna no desktop; ~2 telas abaixo no mobile): não aparece sem rolar. Só existe na visão padrão e na lente "Fronteira e humano"; some com capacidade selecionada e nas lentes "Evolução recente" e "Reuso externo".
3. (Baixa, estilo) Títulos `h3`/`h4` sem classe: 18,7 px/700 (quase o `h2` do nome da capacidade, 19 px), sem espaçamento nem separador; rótulos e valores no mesmo peso; hierarquia plana.
4. (Baixa, texto) "unattended verificado" em inglês; decimais com ponto ("2.80", "0.65") em tela em português.
5. (Baixa, mobile) Sem overflow horizontal, fonte 13 px legível; o botão flutuante do chat sobrepõe o fim da lista de limitações.
6. (Informativa) Console sem erros, 0 requisições com erro, 0 erros de servidor.

## Recomendação
GO funcional (números corretos e fail-closed, sem promoção de maturidade). NO-GO para considerar a interface "validada" sem um ajuste de clareza (achado 1) e de posição (achado 2). Menor ajuste: resumo de 2 linhas no topo do bloco ("Ciclos sem humano comprovados: 0 — sem prova positiva; não significa que nenhum ocorreu") + subir o bloco, mais estilo dos títulos e tradução; item pequeno, só UI/teste.
