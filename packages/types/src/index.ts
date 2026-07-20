// ─── Pillars ──────────────────────────────────────────────────────────────────

export type DefaultPillarId =
  | 'mente'
  | 'proposito'
  | 'trabalho'
  | 'saude'
  | 'relacoes'
  | 'financas'
  | 'lazer';

export type PillarId = DefaultPillarId | (string & {});

export interface PillarConfig {
  id: PillarId;
  name: string;
  /** XP multiplicador por minuto (ex: 1.8 para Mente) */
  xpRate: number;
  isDefault: boolean;
  isCustom: boolean;
}

export const DEFAULT_PILLARS: PillarConfig[] = [
  { id: 'mente',    name: 'Mente',     xpRate: 1.0, isDefault: true, isCustom: false },
  { id: 'proposito',name: 'Propósito', xpRate: 1.0, isDefault: true, isCustom: false },
  { id: 'trabalho', name: 'Trabalho',  xpRate: 1.0, isDefault: true, isCustom: false },
  { id: 'saude',    name: 'Saúde',     xpRate: 1.0, isDefault: true, isCustom: false },
  { id: 'relacoes', name: 'Relações',  xpRate: 1.0, isDefault: true, isCustom: false },
  { id: 'financas', name: 'Finanças',  xpRate: 1.0, isDefault: true, isCustom: false },
  { id: 'lazer',    name: 'Lazer',     xpRate: 1.0, isDefault: true, isCustom: false },
];

export const MIN_ACTIVE_PILLARS = 1;
export const MAX_PRIORITY_PILLARS = 3;

// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  createdAt: Date;
  activePillars: PillarConfig[];
  priorityPillarIds: PillarId[];
}

// ─── XP ───────────────────────────────────────────────────────────────────────

export type ActivityBonusType =
  | 'forgotten_pillar' // pilar sem registro há 5+ dias → +50%
  | 'active_streak'    // 7+ dias consecutivos no pilar → +30%
  | 'first_of_day'     // primeiro registro do dia → +20%
  | 'active_quest';    // ação vinculada a quest em andamento → +40%

export interface XPRecord {
  id: string;
  userId: string;
  pillarId: PillarId;
  questId: string | null;
  durationMinutes: number;
  baseXP: number;
  bonuses: ActivityBonusType[];
  bonusMultiplier: number;
  totalXP: number;
  createdAt: Date;
}

// ─── Quests ───────────────────────────────────────────────────────────────────

export type QuestStatus = 'open' | 'in_progress' | 'completed' | 'abandoned';

export type QuestType = 'main' | 'habit' | 'learning' | 'challenge';

export interface QuestMission {
  id: string;
  title: string;
  /** XP definido pelo usuário na criação da quest — sem renegociação */
  xpReward: number;
  completedAt: Date | null;
}

export interface Quest {
  id: string;
  userId: string;
  pillarId: PillarId;
  title: string;
  type: QuestType;
  status: QuestStatus;
  /** XP total definido na criação (para marcos/conclusão) */
  totalXPReward: number;
  missions: QuestMission[];
  createdAt: Date;
  completedAt: Date | null;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface QuestMilestoneEvent {
  type: 'quest_milestone';
  questId: string;
  missionId: string;
  xpReward: number;
}

export type ContextEventAnchor = 'financial' | 'physical_achievement' | 'meaningful_connection';

export interface ContextEvent {
  type: 'context_event';
  pillarId: PillarId;
  description: string;
  anchorType: ContextEventAnchor;
  /** Valor numérico para âncoras financeiras (R$) ou de saúde (kg, km) */
  anchorValue?: number;
  xpReward: number;
}

export interface StateChangeEvent {
  type: 'state_change';
  pillarId: PillarId;
  description: string;
  previousValue?: number;
  newValue?: number;
  /** XP calculado pelo delta entre estado anterior e novo */
  xpReward: number;
}

export type LifeEvent = QuestMilestoneEvent | ContextEvent | StateChangeEvent;

// ─── Levels & Eras ────────────────────────────────────────────────────────────

export type EraName = 'Despertar' | 'Construção' | 'Expansão' | 'Maestria' | 'Lenda';

export interface Era {
  name: EraName;
  minLevel: number;
  maxLevel: number;
  approximateTotalXP: number;
  estimatedTime: string;
}

export interface PillarProgress {
  pillarId: PillarId;
  level: number;
  totalXP: number;
  xpToNextLevel: number;
  era: Era;
}

export interface CharacterStats {
  level: number;
  era: Era;
  pillars: PillarProgress[];
}

// ─── Database (Supabase) ──────────────────────────────────────

export type { Database, Json, Tables, Enums } from './database';
export { Constants } from './database';

// ─── Onboarding ───────────────────────────────────────────────────────────────

export interface OnboardingData {
  name: string;
  selectedPillarIds: PillarId[];
  customPillars: Pick<PillarConfig, 'id' | 'name' | 'xpRate'>[];
}
