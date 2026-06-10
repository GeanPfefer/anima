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
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_user_id_fkey"
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
          id: string
          name: string
          onboarding_completed_at: string | null
          updated_at: string
        }
        Insert: {
          archetype?: Json | null
          created_at?: string
          id: string
          name: string
          onboarding_completed_at?: string | null
          updated_at?: string
        }
        Update: {
          archetype?: Json | null
          created_at?: string
          id?: string
          name?: string
          onboarding_completed_at?: string | null
          updated_at?: string
        }
        Relationships: []
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
            foreignKeyName: "user_pillars_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "pillar_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_pillars_user_id_fkey"
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
    }
    Functions: {
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
      quest_status: "open" | "in_progress" | "completed" | "abandoned"
      quest_type: "main" | "habit" | "learning" | "challenge"
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
      quest_status: ["open", "in_progress", "completed", "abandoned"],
      quest_type: ["main", "habit", "learning", "challenge"],
    },
  },
  storage: {
    Enums: {},
  },
} as const

