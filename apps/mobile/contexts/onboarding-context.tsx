import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import type { PillarId, PillarConfig } from '@anima/types';
import { getDefaultPillarIds, buildActivePillars } from '@anima/core';
import type { ArchetypeResult } from '@/lib/archetypes';

export type PillarAnswers = Record<string, string[]>;

type CustomPillar = Pick<PillarConfig, 'id' | 'name' | 'xpRate'> & { parentIds?: string[] };

interface OnboardingState {
  name: string;
  selectedPillarIds: PillarId[];
  customPillars: CustomPillar[];
  archetypeAnswers: Record<string, string>;
  archetypeResult: ArchetypeResult | null;
  pillarContexts: Record<string, PillarAnswers>;
}

interface OnboardingContextValue {
  state: OnboardingState;
  allPillarOptions: { id: string; name: string }[];
  setName: (name: string) => void;
  setPillars: (ids: PillarId[], custom: CustomPillar[]) => void;
  setArchetype: (answers: Record<string, string>, result: ArchetypeResult) => void;
  setPillarContext: (pillarId: string, answers: PillarAnswers) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

const INITIAL_STATE: OnboardingState = {
  name: '',
  selectedPillarIds: getDefaultPillarIds(),
  customPillars: [],
  archetypeAnswers: {},
  archetypeResult: null,
  pillarContexts: {},
};

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnboardingState>(INITIAL_STATE);

  const setName = (name: string) => setState((s) => ({ ...s, name }));

  const setPillars = (ids: PillarId[], custom: CustomPillar[]) =>
    setState((s) => ({ ...s, selectedPillarIds: ids, customPillars: custom }));

  const setArchetype = (answers: Record<string, string>, result: ArchetypeResult) =>
    setState((s) => ({ ...s, archetypeAnswers: answers, archetypeResult: result }));

  const setPillarContext = (pillarId: string, answers: PillarAnswers) =>
    setState((s) => ({
      ...s,
      pillarContexts: { ...s.pillarContexts, [pillarId]: answers },
    }));

  // Todos os pilares raiz disponíveis para o picker de pais.
  // Exclui sub-pilares (os que JÁ têm parentIds) — eles não podem ser pai de outros.
  const allPillarOptions = useMemo(() => {
    const active = buildActivePillars(state.selectedPillarIds, state.customPillars as PillarConfig[]);
    const childIds = new Set(
      state.customPillars
        .filter((c) => c.parentIds && c.parentIds.length > 0)
        .map((c) => c.id)
    );
    return active.filter((p) => !childIds.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
  }, [state.selectedPillarIds, state.customPillars]);

  return (
    <OnboardingContext.Provider value={{ state, allPillarOptions, setName, setPillars, setArchetype, setPillarContext }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return ctx;
}
