# WSL — revisão e cancelamento focal

2026-10-10. Revisão do delta coder/readiness PASS: opt-in explícito, padrão nativo preservado, tradução validada por transporte existente, ambiente allowlisted, assinatura Linux, sandbox workspace-write/aprovação never e gates/Verifier do host inalterados.

Prova única fora do ANIMA: pai Python Linux PID3731/start562429 e filho PID3732/start562432, ambos aguardando 40s. Mesmo buildWslCodexInvocation, ambiente e runProcess do coder; AbortController disparado após confirmação de ambos. Resultado cancelled=true, exitCode1, duration181ms. Após 1s, /proc confirmou pai e filho ausentes (não apenas zombies), sem PID reutilizado. PASS no domínio testado. Nenhum SIGTERM adicional necessário; ninguém terceiro encerrado. Dois erros prévios de sintaxe/quoting impediram o Node de iniciar o fixture; não constituíram outras provas Linux.

Limpeza Windows EPERM; diretório próprio anima-wsl-cancel-31Zuut removido pelo Linux, ausência comprovada. Sem correções de código ou nova prova. Não extrapolar esta árvore inofensiva para garantia universal de teardown de processos destacados.

Git dev/6bc4aadef9414d655600c2ea37c6be436b3628c8, índice vazio,46worktrees. Nenhum Host/attempt/banco/proposta/gate/recovery mutado. Item ab9 permanece failed v2. work retry é incompatível com a falha histórica retryable=false (failure_not_retryable); work correct exige changes_requested. Próximo passo sob autorização: preparar candidato pelo fluxo existente proposeRecoverySuccessor/validateRecoverySuccessor e comprovar preservação do checkpoint/escopo antes de persistir successor proposed. Não alterar retroativamente o evento de falha, não aprovar nem executar automaticamente. Configuração WSL no runbook; nenhuma ativação persistente nesta sessão.
