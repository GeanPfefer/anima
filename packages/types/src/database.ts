export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          session_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "conversation_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_sessions: {
        Row: {
          active_turn_started_at: string | null
          archived_at: string | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          active_turn_started_at?: string | null
          archived_at?: string | null
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          active_turn_started_at?: string | null
          archived_at?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_mentions: {
        Row: {
          context_snippet: string | null
          created_at: string
          entity_id: string
          id: string
          xp_record_id: string
        }
        Insert: {
          context_snippet?: string | null
          created_at?: string
          entity_id: string
          id?: string
          xp_record_id: string
        }
        Update: {
          context_snippet?: string | null
          created_at?: string
          entity_id?: string
          id?: string
          xp_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_mentions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "semantic_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_mentions_xp_record_id_fkey"
            columns: ["xp_record_id"]
            isOneToOne: false
            referencedRelation: "xp_records"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_pillars: {
        Row: {
          created_at: string
          entity_id: string
          pillar_id: string
          user_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          entity_id: string
          pillar_id: string
          user_id: string
          weight?: number
        }
        Update: {
          created_at?: string
          entity_id?: string
          pillar_id?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "entity_pillars_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "semantic_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_pillars_pillar_id_fkey"
            columns: ["pillar_id"]
            isOneToOne: false
            referencedRelation: "user_pillars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_pillars_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_embeddings: {
        Row: {
          created_at: string
          embedding: string | null
          id: string
          model_used: string
          user_id: string
          xp_record_id: string
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          id?: string
          model_used?: string
          user_id: string
          xp_record_id: string
        }
        Update: {
          created_at?: string
          embedding?: string | null
          id?: string
          model_used?: string
          user_id?: string
          xp_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_embeddings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_embeddings_xp_record_id_fkey"
            columns: ["xp_record_id"]
            isOneToOne: true
            referencedRelation: "xp_records"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_evidence: {
        Row: {
          created_at: string
          hypothesis_id: string
          id: string
          snippet: string | null
          source_id: string | null
          source_type: string
          user_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          hypothesis_id: string
          id?: string
          snippet?: string | null
          source_id?: string | null
          source_type: string
          user_id: string
          weight?: number
        }
        Update: {
          created_at?: string
          hypothesis_id?: string
          id?: string
          snippet?: string | null
          source_id?: string | null
          source_type?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "identity_evidence_hypothesis_id_fkey"
            columns: ["hypothesis_id"]
            isOneToOne: false
            referencedRelation: "identity_hypotheses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_evidence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_hypotheses: {
        Row: {
          confidence: number
          created_at: string
          description: string | null
          evidence_count: number
          id: string
          label: string
          last_evidence_at: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          description?: string | null
          evidence_count?: number
          id?: string
          label: string
          last_evidence_at?: string | null
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          description?: string | null
          evidence_count?: number
          id?: string
          label?: string
          last_evidence_at?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_hypotheses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          dismissed_at: string | null
          generated_at: string
          id: string
          text: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string | null
          generated_at?: string
          id?: string
          text: string
          user_id: string
        }
        Update: {
          dismissed_at?: string | null
          generated_at?: string
          id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      life_events: {
        Row: {
          anchor_type: Database["public"]["Enums"]["context_anchor"] | null
          anchor_value: number | null
          created_at: string
          description: string
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          mission_id: string | null
          pillar_id: string
          quest_id: string | null
          user_id: string
          xp_awarded: number
        }
        Insert: {
          anchor_type?: Database["public"]["Enums"]["context_anchor"] | null
          anchor_value?: number | null
          created_at?: string
          description: string
          event_type: Database["public"]["Enums"]["event_type"]
          id?: string
          mission_id?: string | null
          pillar_id: string
          quest_id?: string | null
          user_id: string
          xp_awarded: number
        }
        Update: {
          anchor_type?: Database["public"]["Enums"]["context_anchor"] | null
          anchor_value?: number | null
          created_at?: string
          description?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          mission_id?: string | null
          pillar_id?: string
          quest_id?: string | null
          user_id?: string
          xp_awarded?: number
        }
        Relationships: [
          {
            foreignKeyName: "life_events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "quest_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "life_events_pillar_id_fkey"
            columns: ["pillar_id"]
            isOneToOne: false
            referencedRelation: "user_pillars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "life_events_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "life_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          context: Json | null
          created_at: string
          id: string
          note_date: string
          note_type: string | null
          pillar_hint: string | null
          user_id: string
          xp_awarded: number
        }
        Insert: {
          content: string
          context?: Json | null
          created_at?: string
          id?: string
          note_date?: string
          note_type?: string | null
          pillar_hint?: string | null
          user_id: string
          xp_awarded?: number
        }
        Update: {
          content?: string
          context?: Json | null
          created_at?: string
          id?: string
          note_date?: string
          note_type?: string | null
          pillar_hint?: string | null
          user_id?: string
          xp_awarded?: number
        }
        Relationships: [
          {
            foreignKeyName: "notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pillar_catalog: {
        Row: {
          focus: string
          id: string
          name: string
          sort_order: number
          xp_rate: number
        }
        Insert: {
          focus: string
          id: string
          name: string
          sort_order?: number
          xp_rate: number
        }
        Update: {
          focus?: string
          id?: string
          name?: string
          sort_order?: number
          xp_rate?: number
        }
        Relationships: []
      }
      pillar_relationships: {
        Row: {
          child_id: string
          parent_id: string
        }
        Insert: {
          child_id: string
          parent_id: string
        }
        Update: {
          child_id?: string
          parent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pillar_relationships_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "user_pillars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pillar_relationships_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "user_pillars"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          archetype: Json | null
          created_at: string
          display_mode: string
          id: string
          name: string
          onboarding_completed_at: string | null
          updated_at: string
        }
        Insert: {
          archetype?: Json | null
          created_at?: string
          display_mode?: string
          id: string
          name: string
          onboarding_completed_at?: string | null
          updated_at?: string
        }
        Update: {
          archetype?: Json | null
          created_at?: string
          display_mode?: string
          id?: string
          name?: string
          onboarding_completed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_backlog_events: {
        Row: {
          actor: string
          created_at: string
          event_type: Database["public"]["Enums"]["project_backlog_event_type"]
          id: string
          idempotency_key: string
          proposal_id: string
          proposal_version: number
          provenance: Json
          seq: number
          user_id: string
        }
        Insert: {
          actor: string
          created_at?: string
          event_type: Database["public"]["Enums"]["project_backlog_event_type"]
          id?: string
          idempotency_key: string
          proposal_id: string
          proposal_version: number
          provenance: Json
          seq?: never
          user_id: string
        }
        Update: {
          actor?: string
          created_at?: string
          event_type?: Database["public"]["Enums"]["project_backlog_event_type"]
          id?: string
          idempotency_key?: string
          proposal_id?: string
          proposal_version?: number
          provenance?: Json
          seq?: never
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_backlog_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposal_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_events_user_id_proposal_id_proposal_versio_fkey"
            columns: ["user_id", "proposal_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposal_state"
            referencedColumns: ["user_id", "id", "version"]
          },
          {
            foreignKeyName: "project_backlog_events_user_id_proposal_id_proposal_versio_fkey"
            columns: ["user_id", "proposal_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposals"
            referencedColumns: ["user_id", "id", "version"]
          },
        ]
      }
      project_backlog_materialized_items: {
        Row: {
          created_at: string
          dependencies: Json
          position: number
          proposal_id: string
          proposal_version: number
          slice_key: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          dependencies?: Json
          position: number
          proposal_id: string
          proposal_version: number
          slice_key: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          dependencies?: Json
          position?: number
          proposal_id?: string
          proposal_version?: number
          slice_key?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_backlog_materialized_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposal_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_materialized_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_materialized_items_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: true
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      project_backlog_proposals: {
        Row: {
          created_at: string
          exclusions: Json
          id: string
          idempotency_key: string
          objective: string
          provenance: Json
          rationale: string
          slices: Json
          source_decision_id: string
          source_decision_version: number
          supersedes_id: string | null
          uncertainties: Json
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          exclusions?: Json
          id?: string
          idempotency_key: string
          objective: string
          provenance: Json
          rationale?: string
          slices: Json
          source_decision_id: string
          source_decision_version: number
          supersedes_id?: string | null
          uncertainties?: Json
          user_id: string
          version: number
        }
        Update: {
          created_at?: string
          exclusions?: Json
          id?: string
          idempotency_key?: string
          objective?: string
          provenance?: Json
          rationale?: string
          slices?: Json
          source_decision_id?: string
          source_decision_version?: number
          supersedes_id?: string | null
          uncertainties?: Json
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_backlog_proposals_source_decision_id_fkey"
            columns: ["source_decision_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposal_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_proposals_source_decision_id_fkey"
            columns: ["source_decision_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_proposals_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposal_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_proposals_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      project_decision_events: {
        Row: {
          actor: string
          created_at: string
          event_type: Database["public"]["Enums"]["project_decision_event_type"]
          id: string
          idempotency_key: string
          proposal_id: string
          proposal_version: number
          provenance: Json
          seq: number
          user_id: string
        }
        Insert: {
          actor: string
          created_at?: string
          event_type: Database["public"]["Enums"]["project_decision_event_type"]
          id?: string
          idempotency_key: string
          proposal_id: string
          proposal_version: number
          provenance: Json
          seq?: never
          user_id: string
        }
        Update: {
          actor?: string
          created_at?: string
          event_type?: Database["public"]["Enums"]["project_decision_event_type"]
          id?: string
          idempotency_key?: string
          proposal_id?: string
          proposal_version?: number
          provenance?: Json
          seq?: never
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_decision_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposal_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_decision_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_decision_events_user_id_proposal_id_proposal_versi_fkey"
            columns: ["user_id", "proposal_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "project_decision_proposal_state"
            referencedColumns: ["user_id", "id", "version"]
          },
          {
            foreignKeyName: "project_decision_events_user_id_proposal_id_proposal_versi_fkey"
            columns: ["user_id", "proposal_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "project_decision_proposals"
            referencedColumns: ["user_id", "id", "version"]
          },
        ]
      }
      project_decision_proposals: {
        Row: {
          alternatives: Json
          constraints: Json
          created_at: string
          id: string
          idempotency_key: string
          implications: Json
          provenance: Json
          rationale: string
          statement: string
          supersedes_id: string | null
          uncertainties: Json
          user_id: string
          version: number
        }
        Insert: {
          alternatives?: Json
          constraints?: Json
          created_at?: string
          id?: string
          idempotency_key: string
          implications?: Json
          provenance: Json
          rationale?: string
          statement: string
          supersedes_id?: string | null
          uncertainties?: Json
          user_id: string
          version: number
        }
        Update: {
          alternatives?: Json
          constraints?: Json
          created_at?: string
          id?: string
          idempotency_key?: string
          implications?: Json
          provenance?: Json
          rationale?: string
          statement?: string
          supersedes_id?: string | null
          uncertainties?: Json
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_decision_proposals_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposal_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_decision_proposals_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      quest_missions: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          quest_id: string
          sort_order: number
          title: string
          xp_reward: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          quest_id: string
          sort_order?: number
          title: string
          xp_reward: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          quest_id?: string
          sort_order?: number
          title?: string
          xp_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "quest_missions_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
        ]
      }
      quests: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          pillar_id: string
          status: Database["public"]["Enums"]["quest_status"]
          target_date: string | null
          title: string
          type: Database["public"]["Enums"]["quest_type"]
          updated_at: string
          user_id: string
          xp_reward: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          pillar_id: string
          status?: Database["public"]["Enums"]["quest_status"]
          target_date?: string | null
          title: string
          type: Database["public"]["Enums"]["quest_type"]
          updated_at?: string
          user_id: string
          xp_reward: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          pillar_id?: string
          status?: Database["public"]["Enums"]["quest_status"]
          target_date?: string | null
          title?: string
          type?: Database["public"]["Enums"]["quest_type"]
          updated_at?: string
          user_id?: string
          xp_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "quests_pillar_id_fkey"
            columns: ["pillar_id"]
            isOneToOne: false
            referencedRelation: "user_pillars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      semantic_entities: {
        Row: {
          context: string | null
          created_at: string
          entity_type: string
          first_seen_at: string
          id: string
          last_seen_at: string
          name: string
          occurrence_count: number
          user_id: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          entity_type?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name: string
          occurrence_count?: number
          user_id: string
        }
        Update: {
          context?: string | null
          created_at?: string
          entity_type?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name?: string
          occurrence_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "semantic_entities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_pillars: {
        Row: {
          baseline_score: number | null
          catalog_id: string | null
          context: Json | null
          created_at: string
          id: string
          is_active: boolean
          is_priority: boolean
          level: number
          name: string
          pending_activity: Json | null
          sort_order: number
          status: string
          updated_at: string
          user_id: string
          xp_rate: number
          xp_total: number
        }
        Insert: {
          baseline_score?: number | null
          catalog_id?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_priority?: boolean
          level?: number
          name: string
          pending_activity?: Json | null
          sort_order?: number
          status?: string
          updated_at?: string
          user_id: string
          xp_rate: number
          xp_total?: number
        }
        Update: {
          baseline_score?: number | null
          catalog_id?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_priority?: boolean
          level?: number
          name?: string
          pending_activity?: Json | null
          sort_order?: number
          status?: string
          updated_at?: string
          user_id?: string
          xp_rate?: number
          xp_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_pillars_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      work_claims: {
        Row: {
          acquired_at: string
          approved_proposal_version: number
          attempt_id: string | null
          expires_at: string
          id: string
          owner_instance_id: string
          release_reason: string | null
          released_at: string | null
          target_reference: string
          user_id: string
          work_item_id: string
        }
        Insert: {
          acquired_at?: string
          approved_proposal_version: number
          attempt_id?: string | null
          expires_at: string
          id: string
          owner_instance_id: string
          release_reason?: string | null
          released_at?: string | null
          target_reference: string
          user_id: string
          work_item_id: string
        }
        Update: {
          acquired_at?: string
          approved_proposal_version?: number
          attempt_id?: string | null
          expires_at?: string
          id?: string
          owner_instance_id?: string
          release_reason?: string | null
          released_at?: string | null
          target_reference?: string
          user_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_claims_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_contexts: {
        Row: {
          context_references: Json
          created_at: string
          id: string
          version: number
          work_item_id: string
        }
        Insert: {
          context_references: Json
          created_at?: string
          id?: string
          version: number
          work_item_id: string
        }
        Update: {
          context_references?: Json
          created_at?: string
          id?: string
          version?: number
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_contexts_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_events: {
        Row: {
          author: Database["public"]["Enums"]["work_event_author"]
          created_at: string
          event_type: Database["public"]["Enums"]["work_event_type"]
          id: string
          payload: Json
          proposal_version: number | null
          seq: number
          work_item_id: string
        }
        Insert: {
          author: Database["public"]["Enums"]["work_event_author"]
          created_at?: string
          event_type: Database["public"]["Enums"]["work_event_type"]
          id?: string
          payload: Json
          proposal_version?: number | null
          seq?: never
          work_item_id: string
        }
        Update: {
          author?: Database["public"]["Enums"]["work_event_author"]
          created_at?: string
          event_type?: Database["public"]["Enums"]["work_event_type"]
          id?: string
          payload?: Json
          proposal_version?: number | null
          seq?: never
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_events_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_focus: {
        Row: {
          updated_at: string
          user_id: string
          work_item_id: string
        }
        Insert: {
          updated_at?: string
          user_id: string
          work_item_id: string
        }
        Update: {
          updated_at?: string
          user_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_focus_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_items: {
        Row: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        Insert: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at?: string
          id?: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version?: number
          source_message_id: string
          state?: Database["public"]["Enums"]["work_state"]
          updated_at?: string
          user_id: string
        }
        Update: {
          capability?: Database["public"]["Enums"]["work_capability"]
          created_at?: string
          id?: string
          impact_level?: Database["public"]["Enums"]["work_impact_level"]
          intent?: Json
          original_request?: string
          proposal?: Json
          proposal_version?: number
          source_message_id?: string
          state?: Database["public"]["Enums"]["work_state"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_items_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_records: {
        Row: {
          activity_date: string
          base_xp: number
          bonus_multiplier: number
          bonuses: Database["public"]["Enums"]["activity_bonus"][]
          created_at: string
          duration_minutes: number
          id: string
          note: string | null
          pillar_id: string
          quest_id: string | null
          total_xp: number
          user_id: string
        }
        Insert: {
          activity_date?: string
          base_xp: number
          bonus_multiplier?: number
          bonuses?: Database["public"]["Enums"]["activity_bonus"][]
          created_at?: string
          duration_minutes: number
          id?: string
          note?: string | null
          pillar_id: string
          quest_id?: string | null
          total_xp: number
          user_id: string
        }
        Update: {
          activity_date?: string
          base_xp?: number
          bonus_multiplier?: number
          bonuses?: Database["public"]["Enums"]["activity_bonus"][]
          created_at?: string
          duration_minutes?: number
          id?: string
          note?: string | null
          pillar_id?: string
          quest_id?: string | null
          total_xp?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xp_records_pillar_id_fkey"
            columns: ["pillar_id"]
            isOneToOne: false
            referencedRelation: "user_pillars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_records_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      character_stats: {
        Row: {
          active_pillar_count: number | null
          character_level: number | null
          pillars: Json | null
          total_xp_all_pillars: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_pillars_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_backlog_proposal_state: {
        Row: {
          created_at: string | null
          exclusions: Json | null
          id: string | null
          idempotency_key: string | null
          objective: string | null
          provenance: Json | null
          rationale: string | null
          slices: Json | null
          source_decision_id: string | null
          source_decision_version: number | null
          status: string | null
          supersedes_id: string | null
          uncertainties: Json | null
          user_id: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          exclusions?: Json | null
          id?: string | null
          idempotency_key?: string | null
          objective?: string | null
          provenance?: Json | null
          rationale?: string | null
          slices?: Json | null
          source_decision_id?: string | null
          source_decision_version?: number | null
          status?: never
          supersedes_id?: string | null
          uncertainties?: Json | null
          user_id?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          exclusions?: Json | null
          id?: string | null
          idempotency_key?: string | null
          objective?: string | null
          provenance?: Json | null
          rationale?: string | null
          slices?: Json | null
          source_decision_id?: string | null
          source_decision_version?: number | null
          status?: never
          supersedes_id?: string | null
          uncertainties?: Json | null
          user_id?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_backlog_proposals_source_decision_id_fkey"
            columns: ["source_decision_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposal_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_proposals_source_decision_id_fkey"
            columns: ["source_decision_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_proposals_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposal_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_backlog_proposals_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "project_backlog_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      project_decision_proposal_state: {
        Row: {
          alternatives: Json | null
          constraints: Json | null
          created_at: string | null
          id: string | null
          idempotency_key: string | null
          implications: Json | null
          provenance: Json | null
          rationale: string | null
          statement: string | null
          status: string | null
          supersedes_id: string | null
          uncertainties: Json | null
          user_id: string | null
          version: number | null
        }
        Insert: {
          alternatives?: Json | null
          constraints?: Json | null
          created_at?: string | null
          id?: string | null
          idempotency_key?: string | null
          implications?: Json | null
          provenance?: Json | null
          rationale?: string | null
          statement?: string | null
          status?: never
          supersedes_id?: string | null
          uncertainties?: Json | null
          user_id?: string | null
          version?: number | null
        }
        Update: {
          alternatives?: Json | null
          constraints?: Json | null
          created_at?: string | null
          id?: string | null
          idempotency_key?: string | null
          implications?: Json | null
          provenance?: Json | null
          rationale?: string | null
          statement?: string | null
          status?: never
          supersedes_id?: string | null
          uncertainties?: Json | null
          user_id?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_decision_proposals_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposal_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_decision_proposals_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "project_decision_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abandon_current_conversation_turn: { Args: never; Returns: undefined }
      abandoned_work_resumption_source: {
        Args: { p_work_item_id: string }
        Returns: Json
      }
      acquire_work_claim: {
        Args: {
          claim_id: string
          expected_proposal_version: number
          lease_seconds: number
          owner_instance_id: string
          work_item_id: string
        }
        Returns: {
          acquired_at: string
          approved_proposal_version: number
          attempt_id: string | null
          expires_at: string
          id: string
          owner_instance_id: string
          release_reason: string | null
          released_at: string | null
          target_reference: string
          user_id: string
          work_item_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_work_control_at_checkpoint: {
        Args: {
          p_attempt_id: string
          p_expected_proposal_version: number
          p_work_item_id: string
        }
        Returns: Json
      }
      archive_current_conversation: { Args: never; Returns: string }
      attach_work_context: {
        Args: {
          context_references: Json
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: {
          context_references: Json
          created_at: string
          id: string
          version: number
          work_item_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_contexts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auto_approve_autonomous_work: {
        Args: {
          envelope: Json
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: Json
      }
      autonomous_work_budget_status: {
        Args: { p_work_item_id: string }
        Returns: Json
      }
      autonomous_work_queue: {
        Args: never
        Returns: {
          approval_seq: number
          approved_at: string
          approved_proposal_version: number
          capability: Database["public"]["Enums"]["work_capability"]
          queue_position: number
          target_occupied: boolean
          target_reference: string
          work_item_id: string
        }[]
      }
      current_work_retry_readiness: {
        Args: { p_work_item_id: string }
        Returns: Json
      }
      begin_budget_interruption_resumed_attempt: {
        Args: {
          attempt_id: string
          checkpoint_event_seq: number
          claim_id: string
          executor_id: string
          expected_proposal_version: number
          interruption_event_seq: number
          lease_seconds: number
          owner_instance_id: string
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      begin_human_decision_resumed_attempt: {
        Args: {
          attempt_id: string
          claim_id: string
          executor_id: string
          expected_proposal_version: number
          input_provided_event_id: string
          input_requested_event_id: string
          lease_seconds: number
          owner_instance_id: string
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      begin_resumed_work_attempt: {
        Args: {
          abandonment_event_seq: number
          attempt_id: string
          checkpoint_event_seq: number
          claim_id: string
          executor_id: string
          expected_proposal_version: number
          lease_seconds: number
          owner_instance_id: string
          source_attempt_id: string
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      block_work_on_budget: { Args: { p_work_item_id: string }; Returns: Json }
      budget_interruption_resumption_source: {
        Args: { p_work_item_id: string }
        Returns: Json
      }
      create_project_backlog_proposal: {
        Args: {
          exclusions: Json
          idempotency_key: string
          objective: string
          provenance: Json
          rationale: string
          slices: Json
          source_decision_id: string
          source_decision_version: number
          supersedes_id?: string
          uncertainties: Json
        }
        Returns: Json
      }
      create_project_decision_proposal: {
        Args: {
          alternatives: Json
          constraints: Json
          idempotency_key: string
          implications: Json
          provenance: Json
          rationale: string
          statement: string
          supersedes_id?: string
          uncertainties: Json
        }
        Returns: Json
      }
      create_work_proposal: {
        Args: {
          capability: Database["public"]["Enums"]["work_capability"]
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          proposal: Json
          source_message_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_work_intelligence_classification: {
        Args: { p_work_item_id: string }
        Returns: Json
      }
      decide_integration: {
        Args: {
          accepted_result_event_id: string
          decision: Database["public"]["Enums"]["work_integration_decision"]
          decision_id: string
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: Json
      }
      finish_work_execution: {
        Args: {
          execution_id: string
          expected_proposal_version: number
          outcome: Json
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      human_decision_resumption_source: {
        Args: { p_work_item_id: string }
        Returns: Json
      }
      interrupt_work_on_budget: {
        Args: {
          p_attempt_id: string
          p_expected_proposal_version: number
          p_work_item_id: string
        }
        Returns: Json
      }
      latest_work_checkpoint: {
        Args: { p_attempt_id: string; p_work_item_id: string }
        Returns: Json
      }
      lifegame_get_level_from_xp: {
        Args: { p_total_xp: number }
        Returns: number
      }
      match_entries: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          activity_date: string
          note: string
          pillar_name: string
          similarity: number
          xp_record_id: string
        }[]
      }
      materialize_project_backlog_proposal: {
        Args: {
          confirmation_message_id: string
          expected_version: number
          idempotency_key: string
          proposal_id: string
          provenance: Json
        }
        Returns: Json
      }
      next_autonomous_work: {
        Args: never
        Returns: {
          approval_seq: number
          approved_at: string
          approved_proposal_version: number
          capability: Database["public"]["Enums"]["work_capability"]
          queue_size: number
          runner_up_approval_seq: number
          selection_policy: string
          skipped_occupied_targets: number
          target_reference: string
          work_item_id: string
        }[]
      }
      readmit_budget_blocked_work: {
        Args: never
        Returns: {
          budget_reason: string
          work_item_id: string
        }[]
      }
      readmit_budget_interrupted_work: {
        Args: never
        Returns: {
          budget_reason: string
          work_item_id: string
        }[]
      }
      reconcile_supervised_work: {
        Args: never
        Returns: {
          action: string
          attempt_id: string
          claim_id: string
          detail: Json
          finding: string
          item_state: Database["public"]["Enums"]["work_state"]
          work_item_id: string
        }[]
      }
      record_branch_published: {
        Args: {
          authorization_decision_id: string
          expected_proposal_version: number
          receipt: Json
          work_item_id: string
        }
        Returns: Json
      }
      record_commanded_work_terminal: {
        Args: {
          attempt_id: string
          expected_proposal_version: number
          signal: Json
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_host_observed_coder_evidence: {
        Args: {
          attempt_id: string
          evidence: Json
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: Json
      }
      record_host_observed_evidence: {
        Args: {
          attempt_id: string
          evidence: Json
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: Json
      }
      record_host_observed_gate_evidence: {
        Args: {
          attempt_id: string
          evidence: Json
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: Json
      }
      record_review_request_created: {
        Args: {
          authorization_decision_id: string
          expected_proposal_version: number
          receipt: Json
          work_item_id: string
        }
        Returns: Json
      }
      record_verifier_opinion: {
        Args: {
          attempt_id: string
          expected_proposal_version: number
          opinion: Json
          work_item_id: string
        }
        Returns: Json
      }
      record_work_checkpoint: {
        Args: {
          attempt_id: string
          expected_proposal_version: number
          signal: Json
          work_item_id: string
        }
        Returns: Json
      }
      record_work_decision_required: {
        Args: {
          p_attempt_id: string
          p_expected_proposal_version: number
          p_signal: Json
          p_work_item_id: string
        }
        Returns: Json
      }
      record_work_intelligence_classification: {
        Args: {
          p_classification: Json
          p_expected_classification_revision: number
          p_expected_proposal_version: number
          p_work_item_id: string
        }
        Returns: Json
      }
      record_work_routing_adjustment: {
        Args: {
          p_adjustment: Json
          p_attempt_id: string
          p_expected_proposal_version: number
          p_work_item_id: string
        }
        Returns: Json
      }
      record_work_routing_decision: {
        Args: {
          p_attempt_id: string
          p_decision: Json
          p_expected_proposal_version: number
          p_work_item_id: string
        }
        Returns: Json
      }
      release_manual_work: {
        Args: { p_expected_proposal_version: number; p_work_item_id: string }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_work_claim: {
        Args: { claim_id: string; reason: string }
        Returns: {
          acquired_at: string
          approved_proposal_version: number
          attempt_id: string | null
          expires_at: string
          id: string
          owner_instance_id: string
          release_reason: string | null
          released_at: string | null
          target_reference: string
          user_id: string
          work_item_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_latest_conversation: { Args: never; Returns: string }
      request_project_backlog_proposal_changes: {
        Args: {
          expected_version: number
          idempotency_key: string
          proposal_id: string
          requested_changes: string
          source_message_id: string
        }
        Returns: Json
      }
      request_work_control: {
        Args: {
          p_action: string
          p_attempt_id: string
          p_expected_proposal_version: number
          p_work_item_id: string
        }
        Returns: Json
      }
      request_autonomous_execution: {
        Args: { p_expected_proposal_version: number; p_request_id: string; p_work_item_id: string }
        Returns: Json
      }
      request_work_retry: {
        Args: { p_expected_proposal_version: number; p_failure_event_id: string; p_retry_request_id: string; p_work_item_id: string }
        Returns: Json
      }
      request_work_proposal_revision: {
        Args: {
          expected_proposal_version: number
          intent: Json
          proposal: Json
          requested_changes: string
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_approval: {
        Args: {
          decision: Database["public"]["Enums"]["work_approval_decision"]
          decision_context?: Json
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_project_decision_proposal: {
        Args: {
          expected_version: number
          idempotency_key: string
          outcome: Database["public"]["Enums"]["project_decision_event_type"]
          proposal_id: string
          provenance: Json
        }
        Returns: Json
      }
      respond_to_work_decision: {
        Args: {
          p_expected_proposal_version: number
          p_input_requested_event_id: string
          p_option_id: string
          p_work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_work_result: {
        Args: {
          decision: Database["public"]["Enums"]["work_review_decision"]
          decision_context?: Json
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_work_result_versioned: {
        Args: {
          decision: Database["public"]["Enums"]["work_review_decision"]
          decision_context?: Json
          expected_proposal_version: number
          reviewed_result_event_id: string
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revise_work_proposal: {
        Args: {
          expected_proposal_version: number
          intent: Json
          proposal: Json
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      select_autonomous_work: {
        Args: { p_expected_proposal_version: number; p_work_item_id: string }
        Returns: {
          approval_seq: number
          approved_at: string
          approved_proposal_version: number
          capability: Database["public"]["Enums"]["work_capability"]
          queue_size: number
          runner_up_approval_seq: number
          selection_policy: string
          skipped_occupied_targets: number
          target_reference: string
          work_item_id: string
        }[]
      }
      set_work_focus: {
        Args: { work_item_id: string }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_claimed_work_attempt: {
        Args: { attempt_id: string; claim_id: string; executor_id: string }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_commanded_work_attempt: {
        Args: {
          attempt_id: string
          executor_id: string
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_work: {
        Args: { expected_proposal_version: number; work_item_id: string }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_work_execution: {
        Args: {
          execution_id: string
          executor_id: string
          expected_proposal_version: number
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_work_result: {
        Args: {
          expected_proposal_version: number
          result: Json
          work_item_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["work_capability"]
          created_at: string
          id: string
          impact_level: Database["public"]["Enums"]["work_impact_level"]
          intent: Json
          original_request: string
          proposal: Json
          proposal_version: number
          source_message_id: string
          state: Database["public"]["Enums"]["work_state"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      work_routing_adjustment_context: {
        Args: { p_work_item_id: string }
        Returns: Json
      }
      work_routing_decision: { Args: { p_attempt_id: string }; Returns: Json }
    }
    Enums: {
      activity_bonus:
        | "forgotten_pillar"
        | "active_streak"
        | "first_of_day"
        | "active_quest"
      context_anchor:
        | "financial"
        | "physical_achievement"
        | "meaningful_connection"
      event_type: "quest_milestone" | "context_event" | "state_change"
      project_backlog_event_type:
        | "proposal_created"
        | "changes_requested"
        | "materialization_confirmed"
        | "materialized"
      project_decision_event_type:
        | "proposal_created"
        | "ratified"
        | "rejected"
        | "changes_requested"
      quest_status: "open" | "in_progress" | "completed" | "abandoned"
      quest_type: "main" | "habit" | "learning" | "challenge"
      work_approval_decision: "approve" | "reject" | "request_changes" | "defer"
      work_capability:
        | "programming"
        | "research"
        | "architecture"
        | "planning"
        | "learning"
        | "organization"
        | "home_automation"
        | "critical_reflection"
      work_event_author: "user" | "anima" | "executor" | "system"
      work_event_type:
        | "work_proposed"
        | "proposal_revised"
        | "proposal_changes_requested"
        | "work_deferred"
        | "work_approved"
        | "work_rejected"
        | "work_started"
        | "context_attached"
        | "input_requested"
        | "input_provided"
        | "work_blocked"
        | "execution_started"
        | "execution_failed"
        | "result_submitted"
        | "changes_requested"
        | "result_accepted"
        | "work_cancelled"
        | "work_claimed"
        | "work_claim_released"
        | "attempt_abandoned"
        | "checkpoint_recorded"
        | "work_intelligence_classified"
        | "work_routing_decided"
        | "work_routing_adjusted"
        | "work_control_requested"
        | "work_paused"
        | "integration_decided"
        | "branch_published"
        | "review_request_created"
        | "host_observed_evidence_recorded"
        | "verifier_opinion_recorded"
        | "host_observed_gate_evidence_recorded"
        | "host_observed_coder_evidence_recorded"
        | "manual_work_released"
      work_impact_level:
        | "low"
        | "significant"
        | "structural"
        | "strategic"
        | "financial"
        | "irreversible"
        | "external"
      work_integration_decision: "authorize" | "refuse"
      work_review_decision: "accept" | "request_changes"
      work_state:
        | "proposed"
        | "approved"
        | "in_progress"
        | "blocked"
        | "review"
        | "changes_requested"
        | "completed"
        | "failed"
        | "rejected"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          created_at: string | null
          id: string
          name: string
          owner: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          name: string
          owner?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          owner?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          updated_at: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          updated_at?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_bonus: [
        "forgotten_pillar",
        "active_streak",
        "first_of_day",
        "active_quest",
      ],
      context_anchor: [
        "financial",
        "physical_achievement",
        "meaningful_connection",
      ],
      event_type: ["quest_milestone", "context_event", "state_change"],
      project_backlog_event_type: [
        "proposal_created",
        "changes_requested",
        "materialization_confirmed",
        "materialized",
      ],
      project_decision_event_type: [
        "proposal_created",
        "ratified",
        "rejected",
        "changes_requested",
      ],
      quest_status: ["open", "in_progress", "completed", "abandoned"],
      quest_type: ["main", "habit", "learning", "challenge"],
      work_approval_decision: ["approve", "reject", "request_changes", "defer"],
      work_capability: [
        "programming",
        "research",
        "architecture",
        "planning",
        "learning",
        "organization",
        "home_automation",
        "critical_reflection",
      ],
      work_event_author: ["user", "anima", "executor", "system"],
      work_event_type: [
        "work_proposed",
        "proposal_revised",
        "proposal_changes_requested",
        "work_deferred",
        "work_approved",
        "work_rejected",
        "work_started",
        "context_attached",
        "input_requested",
        "input_provided",
        "work_blocked",
        "execution_started",
        "execution_failed",
        "result_submitted",
        "changes_requested",
        "result_accepted",
        "work_cancelled",
        "work_claimed",
        "work_claim_released",
        "attempt_abandoned",
        "checkpoint_recorded",
        "work_intelligence_classified",
        "work_routing_decided",
        "work_routing_adjusted",
        "work_control_requested",
        "work_paused",
        "integration_decided",
        "branch_published",
        "review_request_created",
        "host_observed_evidence_recorded",
        "verifier_opinion_recorded",
        "host_observed_gate_evidence_recorded",
        "host_observed_coder_evidence_recorded",
        "manual_work_released",
      ],
      work_impact_level: [
        "low",
        "significant",
        "structural",
        "strategic",
        "financial",
        "irreversible",
        "external",
      ],
      work_integration_decision: ["authorize", "refuse"],
      work_review_decision: ["accept", "request_changes"],
      work_state: [
        "proposed",
        "approved",
        "in_progress",
        "blocked",
        "review",
        "changes_requested",
        "completed",
        "failed",
        "rejected",
        "cancelled",
      ],
    },
  },
  storage: {
    Enums: {},
  },
} as const
