'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './PillarEditor.module.css';

type Pillar = { id: string; name: string; is_active: boolean; xp_total: number };

export default function PillarEditor({
  initialPillars,
  initialParents,
  userId,
}: {
  initialPillars: Pillar[];
  initialParents?: Record<string, string>;
  userId: string;
}) {
  const supabase = createClient();
  const [pillars, setPillars] = useState<Pillar[]>(initialPillars);
  const [parents, setParents] = useState<Record<string, string>>(initialParents ?? {});
  const [editedNames, setEditedNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function changeParent(pillar: Pillar, parentId: string) {
    setSaving((s) => ({ ...s, [pillar.id]: true }));
    setErrors((e) => ({ ...e, [pillar.id]: '' }));
    const endpoint = parentId ? '/api/pillars/link' : '/api/pillars/unlink';
    const body = parentId ? { childId: pillar.id, parentId } : { childId: pillar.id };
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }).catch(() => null);
    setSaving((s) => ({ ...s, [pillar.id]: false }));
    if (!res?.ok) {
      const reason = res ? (await res.json().catch(() => ({}))).error : null;
      setErrors((e) => ({ ...e, [pillar.id]: reason === 'cycle' ? 'Isso criaria um ciclo' : 'Erro ao vincular' }));
      return;
    }
    setParents((prev) => {
      const next = { ...prev };
      if (parentId) next[pillar.id] = parentId; else delete next[pillar.id];
      return next;
    });
  }

  // Novo pilar
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function saveName(pillar: Pillar) {
    const name = (editedNames[pillar.id] ?? pillar.name).trim();
    if (!name || name === pillar.name) {
      setEditedNames((prev) => { const next = { ...prev }; delete next[pillar.id]; return next; });
      return;
    }
    setSaving((s) => ({ ...s, [pillar.id]: true }));
    setErrors((e) => ({ ...e, [pillar.id]: '' }));
    const { error } = await supabase.from('user_pillars').update({ name }).eq('id', pillar.id);
    setSaving((s) => ({ ...s, [pillar.id]: false }));
    if (error) {
      setErrors((e) => ({ ...e, [pillar.id]: 'Erro ao salvar' }));
    } else {
      setPillars((prev) => prev.map((p) => p.id === pillar.id ? { ...p, name } : p));
      setEditedNames((prev) => { const next = { ...prev }; delete next[pillar.id]; return next; });
    }
  }

  async function toggleActive(pillar: Pillar) {
    setSaving((s) => ({ ...s, [pillar.id]: true }));
    const is_active = !pillar.is_active;
    const { error } = await supabase.from('user_pillars').update({ is_active }).eq('id', pillar.id);
    setSaving((s) => ({ ...s, [pillar.id]: false }));
    if (error) {
      setErrors((e) => ({ ...e, [pillar.id]: 'Erro ao salvar' }));
    } else {
      setPillars((prev) => prev.map((p) => p.id === pillar.id ? { ...p, is_active } : p));
    }
  }

  async function deletePillar(pillar: Pillar) {
    if (!window.confirm(`Apagar "${pillar.name}"? Isso é permanente.`)) return;
    setSaving((s) => ({ ...s, [pillar.id]: true }));
    const { error } = await supabase.from('user_pillars').delete().eq('id', pillar.id);
    setSaving((s) => ({ ...s, [pillar.id]: false }));
    if (error) {
      setErrors((e) => ({ ...e, [pillar.id]: 'Erro ao apagar' }));
    } else {
      setPillars((prev) => prev.filter((p) => p.id !== pillar.id));
    }
  }

  async function createPillar() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError('');
    const { data, error } = await supabase
      .from('user_pillars')
      .insert({ user_id: userId, name, xp_rate: 1.0, is_active: true, sort_order: pillars.length })
      .select('id, name, is_active, xp_total')
      .single();
    setCreating(false);
    if (error || !data) {
      setCreateError(error?.message ?? 'Erro ao criar pilar');
    } else {
      setPillars((prev) => [...prev, data as Pillar]);
      setNewName('');
    }
  }

  const sorted = [...pillars].sort((a, b) => {
    if (a.is_active === b.is_active) return 0;
    return a.is_active ? -1 : 1;
  });

  return (
    <div className={styles.root}>
      <div className={styles.list}>
        {sorted.length === 0 && (
          <p className={styles.empty}>Nenhum pilar ainda.</p>
        )}
        {sorted.map((p) => {
          const currentName = editedNames[p.id] ?? p.name;
          const isSaving = !!saving[p.id];
          const canDelete = p.xp_total === 0;
          return (
            <div key={p.id} className={[styles.row, !p.is_active ? styles.rowInactive : ''].filter(Boolean).join(' ')}>
              <input
                className={styles.nameInput}
                value={currentName}
                onChange={(e) => setEditedNames((n) => ({ ...n, [p.id]: e.target.value }))}
                onBlur={() => saveName(p)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                disabled={isSaving}
                aria-label={`Nome do pilar ${p.name}`}
              />
              <select
                className={styles.parentSelect}
                value={parents[p.id] ?? ''}
                onChange={(e) => changeParent(p, e.target.value)}
                disabled={isSaving}
                aria-label={`Pilar pai de ${p.name}`}
                title="Faz parte de"
              >
                <option value="">— sem pai —</option>
                {pillars
                  .filter((o) => o.id !== p.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>faz parte de {o.name}</option>
                  ))}
              </select>
              <button
                className={[styles.toggle, p.is_active ? styles.toggleOn : styles.toggleOff].join(' ')}
                onClick={() => toggleActive(p)}
                disabled={isSaving}
              >
                {p.is_active ? 'ativo' : 'inativo'}
              </button>
              {canDelete ? (
                <button
                  className={styles.deleteBtn}
                  onClick={() => deletePillar(p)}
                  disabled={isSaving}
                  aria-label={`Apagar pilar ${p.name}`}
                  title="Apagar pilar"
                >
                  ×
                </button>
              ) : (
                <span className={styles.deleteDisabled} title="Pilar com XP não pode ser apagado — inative-o">×</span>
              )}
              {errors[p.id] && <span className={styles.error}>{errors[p.id]}</span>}
            </div>
          );
        })}
      </div>

      {/* Adicionar novo pilar */}
      <div className={styles.addRow}>
        <input
          className={styles.addInput}
          placeholder="Nome do novo pilar"
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setCreateError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') createPillar(); }}
          disabled={creating}
          maxLength={40}
        />
        <button
          className={styles.addBtn}
          onClick={createPillar}
          disabled={!newName.trim() || creating}
        >
          {creating ? '…' : '+ Adicionar'}
        </button>
      </div>
      {createError && <p className={styles.error}>{createError}</p>}
    </div>
  );
}
