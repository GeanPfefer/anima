# Marco 006 — Política de Segurança como Maturidade Máxima

> Registro histórico. **Append-only** — mudanças futuras devem criar um novo marco, sem apagar a decisão registrada aqui. Este marco **corrige a classificação** de uma capacidade feita no [Marco 005](005-autonomia-progressiva-e-identidade-una.md); ele **não reescreve** o Marco 005, que permanece íntegro. Registra uma decisão humana de **direção e princípios**, não uma especificação técnica.

**Data:** 2026-08-12

---

## Contexto

O [Marco 005](005-autonomia-progressiva-e-identidade-una.md) tornou canônica a distinção entre **restrição fundamental** e **restrição de maturidade** e reclassificou corretamente vários limites da V0 como maturidade — dívida de evidência, não teto. Porém, no fecho de rastreabilidade (Marco 005, seção "O que este marco reinterpreta"), ele classificou **alterar a própria política de segurança** como permanecendo **fundamental (não meramente de maturidade)**. Essa classificação está **errada** e é corrigida aqui.

O erro é de categoria, não de proteção. A definição de "restrição fundamental" no próprio Marco 005 (§1) tem exatamente dois sentidos legítimos:

1. algo que **ainda não foi definido** (uma decisão de produto pendente); ou
2. algo que é **intrinsecamente uma decisão de quem cria a instância** — quando realmente expressa a vontade/identidade do criador.

Alterar a política de segurança **não** é nenhum dos dois. Está perfeitamente definida como capacidade, e não é uma expressão de identidade do criador — é uma **capacidade operacional de altíssimo risco**. Portanto não é fundamental: é uma **restrição de maturidade**, a de **grau mais alto** do sistema.

Este marco **não afrouxa nenhuma proteção vigente**. No estado atual, alterar a própria política de segurança permanece **corretamente protegida por governança humana/reforçada**. O que muda é apenas a **leitura do porquê**: não é um teto filosófico eterno reservado ao humano; é o topo da escada de maturidade, cujo bloqueio atual é uma dívida de evidência **excepcionalmente pesada**, não uma impossibilidade de princípio.

---

## 1. Correção da classificação (política)

**Alterar a própria política de segurança é uma restrição de maturidade de grau máximo, não uma restrição fundamental.**

- Não é fundamental por "não estar definida": está definida como capacidade.
- Não é fundamental por ser "intrinsecamente do criador da instância": é uma capacidade operacional, não uma expressão de vontade/identidade do criador.
- É a capacidade de **maior risco** do sistema — porque muda a regra que **define autoridade** — e por isso é, hoje, corretamente reservada à governança humana/reforçada. Esse bloqueio é uma **dívida de evidência**, não um limite de princípio.

> **Princípio:** mudar a política de segurança é o **ato mais protegido** do sistema, mas "mais protegido" não é sinônimo de "eternamente humano". É o extremo superior da autonomia progressiva por evidência (Marco 005 §2), não uma exceção fora dela.

Isto **confirma a substância** do Marco 005 §10 ("Governança das próprias políticas de segurança"), que já afirmava que "o objetivo final não é congelar as políticas para sempre; é permitir que evoluam com segurança". O que se corrige é apenas o **rótulo** aplicado no fecho de rastreabilidade do Marco 005 (linha "Permanecem fundamentais"), que contradizia o próprio §10.

## 2. O que permanece fundamental (preservado)

Continuam **fundamentais** — não meramente de maturidade — até definição humana em contrário:

- **decisões intrinsecamente do criador da instância**, quando realmente expressarem a **vontade ou a identidade** do criador (não como pretexto para congelar capacidades operacionais);
- **decisões de produto ainda não definidas** (ex.: a superfície de UI de auto-desenvolvimento — "fundamental porque não definida", cf. [Plano 002](../planos/002-modo-autonomo-v0.md)), até que sejam decididas.

A distinção precisa ser mantida limpa: "fundamental" descreve **identidade/vontade do criador** e **ausência de decisão**, nunca **risco**. Risco alto — inclusive o mais alto — é sempre **maturidade**, governada por evidência e processo proporcional ao risco.

## 3. Processo reforçado para promover a política (política)

Porque é a maturidade de grau máximo, promovê-la exige um processo **muito mais forte** do que promover qualquer outra capacidade — e mais forte, também, do que o texto do Marco 005 §10 enumerou. Antes de qualquer autonomia sobre a própria política de segurança, são exigidos, no mínimo:

- **isolamento** (execução da mudança em ambiente contido, sem alcançar a política viva);
- **testes adversariais** dirigidos à própria mudança de política;
- **replay/simulação** de casos históricos e de cenários de ataque;
- **revisão independente** (Reviewer/Verifier separado de quem propõe — Marco 005 §9), preferindo diversidade de provider;
- **auditabilidade** completa (proveniência, correlação e trilha da decisão);
- **reversibilidade/rollback** comprovada da mudança;
- **rollout gradual** com **promoção progressiva** e período de observação;
- **observabilidade** contínua do efeito da política em produção;
- **limites explícitos** de escopo, alcance e duração da autoridade concedida;
- **revogação automática** diante de qualquer evidência de comportamento inseguro.

Enquanto essa evidência não existir e não for verificada de forma independente, a capacidade permanece **fail-closed** sob governança humana/reforçada. Nenhum desses requisitos é afrouxado por este marco; ele os **nomeia e eleva** como a barra de promoção mais alta do sistema.

> **Princípio:** o objetivo final não é congelar a política para sempre; é permitir que ela evolua **somente** sob a maior das garantias. Reclassificar o bloqueio como maturidade **não** aproxima sua promoção — apenas registra que a barra é de evidência, não de princípio.

---

## O que este marco corrige (rastreabilidade)

Nenhuma decisão do Marco 005 é apagada. As seguintes formulações passam a ser lidas à luz deste marco:

- **[Marco 005](005-autonomia-progressiva-e-identidade-una.md) — fecho "O que este marco reinterpreta" ("Permanecem fundamentais … modificar a própria política de segurança").** **Reclassificado:** alterar a própria política de segurança é **restrição de maturidade de grau máximo**, não fundamental. Permanece corretamente sob governança humana/reforçada (nada afrouxado). Continua fundamental apenas: decisões intrinsecamente do criador da instância e decisões de produto ainda não definidas.
- **[Marco 005](005-autonomia-progressiva-e-identidade-una.md) §10 e §11.** **Confirmados na substância** (processo reforçado; segurança como sistema evolutivo). Este marco os torna coerentes com o §2 do Marco 005 (autoridade conquistada e revogável por evidência), aplicando-o também — no grau mais alto — à própria política.
- **[`anima-manifesto.md`](../../anima-manifesto.md) — "Nenhum efeito é, por princípio, exclusivamente humano para sempre … A exceção é alterar a própria política de segurança".** A palavra "exceção" é corrigida: alterar a política **não** é uma exceção ao princípio de maturidade; é o **caso extremo** dele. Ajuste cirúrgico + ponteiro para cá.
- **[`anima-prd.md`](../../anima-prd.md) — "Mapa de maturidade do ciclo de programação", linha "alterar a própria política de segurança … fundamental".** Reclassificada para **maturidade máxima (o ato mais protegido)**, apontando para cá. Estado tático vivo, editado no lugar.
- **[Plano 002](../planos/002-modo-autonomo-v0.md) — tabela "Classificação das fronteiras atualmente bloqueadas por humano", linha da política de segurança.** Corrigida por seção de continuação append-only que reclassifica a linha como maturidade de grau máximo, sem apagar o registro anterior.
- **[Registro 2026-08-12 — ratificação da autonomia progressiva](../registros/2026-08-12-ratificacao-autonomia-progressiva.md).** Registro é append-only e **não** é editado; é corrigido por um **novo registro** desta sessão que aponta o anterior.

---

## Consequência

Ao encontrar a mudança da própria política de segurança bloqueada, o trabalho deve tratá-la como **maturidade de grau máximo**: nunca afrouxar a proteção vigente, e — quando/se for objeto de trabalho — buscar acumular a evidência do §3 (isolamento, testes adversariais, replay/simulação, revisão independente, auditabilidade, rollback, rollout gradual, observabilidade, limites explícitos, revogação automática). A pergunta canônica do Marco 005 §1 vale também aqui, no grau mais exigente: *o que ainda precisamos provar — e sob quais garantias — para promovê-la?*

Explicitamente **proibido** sem nova base canônica e sem a evidência do §3: alterar a própria política de segurança de forma autônoma; reduzir qualquer proteção vigente "para seguir a visão"; ou usar esta reclassificação como pretexto para promover a capacidade agora. Reclassificar o bloqueio como maturidade **não** o promove — apenas corrige por que ele existe.

---

## Referências

- [Marco 005 — Autonomia Progressiva e Identidade Una](005-autonomia-progressiva-e-identidade-una.md) (§1 definição de fundamental/maturidade; §2 autoridade por evidência; §9 papéis separáveis; §10 governança da política; §11 segurança evolutiva)
- [`../../anima-manifesto.md`](../../anima-manifesto.md) — princípios permanentes
- [`../../anima-prd.md`](../../anima-prd.md) — estado tático vivo e mapa de maturidade
- [Plano 002 — Modo Autônomo V0](../planos/002-modo-autonomo-v0.md)
- [Registro 2026-08-12 — ratificação da autonomia progressiva](../registros/2026-08-12-ratificacao-autonomia-progressiva.md)
