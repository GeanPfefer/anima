-- Impõe unicidade de pilar por (user_id, nome) — antes, três caminhos de
-- detecção (atividade, quest, entidade) podiam criar o mesmo pilar pendente em
-- paralelo numa mesma mensagem, gerando duplicatas ("Música" ×4). Primeiro
-- consolida duplicatas existentes, repontando as FKs, depois cria o índice.

-- Mapa duplicata → sobrevivente (mais antigo; ativo tem prioridade sobre pendente).
CREATE TEMP TABLE pillar_dedup AS
SELECT id AS dup_id,
       first_value(id) OVER (
         PARTITION BY user_id, lower(name)
         ORDER BY (status = 'active') DESC, created_at ASC, id ASC
       ) AS keep_id
FROM public.user_pillars;

DELETE FROM pillar_dedup WHERE dup_id = keep_id;

-- Reaponta FKs simples.
UPDATE public.xp_records  x SET pillar_id = m.keep_id FROM pillar_dedup m WHERE x.pillar_id = m.dup_id;
UPDATE public.quests      q SET pillar_id = m.keep_id FROM pillar_dedup m WHERE q.pillar_id = m.dup_id;
UPDATE public.life_events l SET pillar_id = m.keep_id FROM pillar_dedup m WHERE l.pillar_id = m.dup_id;

-- entity_pillars: PK (entity_id, pillar_id) — remove o que viraria duplicado antes de repontar.
DELETE FROM public.entity_pillars ep USING pillar_dedup m
 WHERE ep.pillar_id = m.dup_id
   AND EXISTS (SELECT 1 FROM public.entity_pillars e2
               WHERE e2.entity_id = ep.entity_id AND e2.pillar_id = m.keep_id);
UPDATE public.entity_pillars ep SET pillar_id = m.keep_id FROM pillar_dedup m WHERE ep.pillar_id = m.dup_id;

-- pillar_relationships: reaponta pai e filho, depois limpa auto-loops e arestas repetidas.
UPDATE public.pillar_relationships r SET parent_id = m.keep_id FROM pillar_dedup m WHERE r.parent_id = m.dup_id;
UPDATE public.pillar_relationships r SET child_id  = m.keep_id FROM pillar_dedup m WHERE r.child_id  = m.dup_id;
DELETE FROM public.pillar_relationships WHERE parent_id = child_id;
DELETE FROM public.pillar_relationships a USING public.pillar_relationships b
 WHERE a.ctid < b.ctid AND a.parent_id = b.parent_id AND a.child_id = b.child_id;

-- Remove os pilares duplicados já sem referências.
DELETE FROM public.user_pillars u USING pillar_dedup m WHERE u.id = m.dup_id;

DROP TABLE pillar_dedup;

-- Unicidade case-insensitive por usuário. Expression index (não serve de alvo de
-- upsert no PostgREST) — o código trata conflito relendo o pilar existente.
CREATE UNIQUE INDEX IF NOT EXISTS user_pillars_user_name_uniq
  ON public.user_pillars (user_id, lower(name));
