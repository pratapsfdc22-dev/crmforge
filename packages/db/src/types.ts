/**
 * ForgeSF Database Types
 * Generated from Supabase schema
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          tier: 'trial' | 'starter' | 'professional' | 'enterprise'
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          seat_limit: number
          task_quota: number
          trial_ends_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          tier?: 'trial' | 'starter' | 'professional' | 'enterprise'
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          seat_limit?: number
          task_quota?: number
          trial_ends_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          tier?: 'trial' | 'starter' | 'professional' | 'enterprise'
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          seat_limit?: number
          task_quota?: number
          trial_ends_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      org_members: {
        Row: {
          org_id: string
          user_id: string
          role: 'owner' | 'admin' | 'developer' | 'viewer'
          invited_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          org_id: string
          user_id: string
          role: 'owner' | 'admin' | 'developer' | 'viewer'
          invited_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          org_id?: string
          user_id?: string
          role?: 'owner' | 'admin' | 'developer' | 'viewer'
          invited_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          id: string
          org_id: string
          email: string
          role: 'admin' | 'developer' | 'viewer'
          token: string
          expires_at: string
          accepted_at: string | null
          invited_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          email: string
          role: 'admin' | 'developer' | 'viewer'
          token?: string
          expires_at?: string
          accepted_at?: string | null
          invited_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          email?: string
          role?: 'admin' | 'developer' | 'viewer'
          token?: string
          expires_at?: string
          accepted_at?: string | null
          invited_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      salesforce_connections: {
        Row: {
          id: string
          org_id: string
          name: string
          instance_url: string
          access_token_encrypted: string
          refresh_token_encrypted: string
          salesforce_org_id: string
          salesforce_username: string | null
          is_active: boolean
          last_sync_at: string | null
          last_error: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          instance_url: string
          access_token_encrypted: string
          refresh_token_encrypted: string
          salesforce_org_id: string
          salesforce_username?: string | null
          is_active?: boolean
          last_sync_at?: string | null
          last_error?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          instance_url?: string
          access_token_encrypted?: string
          refresh_token_encrypted?: string
          salesforce_org_id?: string
          salesforce_username?: string | null
          is_active?: boolean
          last_sync_at?: string | null
          last_error?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_tasks: {
        Row: {
          id: string
          org_id: string
          title: string
          description: string | null
          status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          salesforce_connection_id: string | null
          agent_run_id: string | null
          prompt_tokens: number
          completion_tokens: number
          total_cost_usd: number
          result_summary: string | null
          error_message: string | null
          started_at: string | null
          completed_at: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          title: string
          description?: string | null
          status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          salesforce_connection_id?: string | null
          agent_run_id?: string | null
          prompt_tokens?: number
          completion_tokens?: number
          total_cost_usd?: number
          result_summary?: string | null
          error_message?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          title?: string
          description?: string | null
          status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          salesforce_connection_id?: string | null
          agent_run_id?: string | null
          prompt_tokens?: number
          completion_tokens?: number
          total_cost_usd?: number
          result_summary?: string | null
          error_message?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      task_artifacts: {
        Row: {
          id: string
          task_id: string
          type: 'code' | 'log' | 'screenshot' | 'file' | 'other'
          name: string
          content_url: string | null
          content_text: string | null
          mime_type: string | null
          size_bytes: number | null
          created_at: string
        }
        Insert: {
          id?: string
          task_id: string
          type: 'code' | 'log' | 'screenshot' | 'file' | 'other'
          name: string
          content_url?: string | null
          content_text?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          task_id?: string
          type?: 'code' | 'log' | 'screenshot' | 'file' | 'other'
          name?: string
          content_url?: string | null
          content_text?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          created_at?: string
        }
        Relationships: []
      }
      usage_records: {
        Row: {
          id: string
          org_id: string
          period_start: string
          period_end: string
          tasks_executed: number
          total_tokens: number
          total_cost_usd: number
          stripe_invoice_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          period_start: string
          period_end: string
          tasks_executed?: number
          total_tokens?: number
          total_cost_usd?: number
          stripe_invoice_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          period_start?: string
          period_end?: string
          tasks_executed?: number
          total_tokens?: number
          total_cost_usd?: number
          stripe_invoice_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          id: string
          org_id: string
          actor_user_id: string | null
          action: string
          target_type: string | null
          target_id: string | null
          payload_hash: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          actor_user_id?: string | null
          action: string
          target_type?: string | null
          target_id?: string | null
          payload_hash: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          actor_user_id?: string | null
          action?: string
          target_type?: string | null
          target_id?: string | null
          payload_hash?: string
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      connection_secrets: {
        Row: {
          id: string
          org_id: string
          user_id: string | null
          kind: 'salesforce_jwt' | 'jira_oauth' | 'n8n_api_key'
          enc_payload: Buffer
          key_version: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id?: string | null
          kind: 'salesforce_jwt' | 'jira_oauth' | 'n8n_api_key'
          enc_payload: Buffer
          key_version?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string | null
          kind?: 'salesforce_jwt' | 'jira_oauth' | 'n8n_api_key'
          enc_payload?: Buffer
          key_version?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sf_connections: {
        Row: {
          id: string
          org_id: string
          label: string
          env: 'sandbox' | 'production'
          instance_url: string
          consumer_key: string
          sf_username: string
          status: 'pending' | 'verified' | 'failed' | 'revoked'
          last_verified_at: string | null
          failure_reason: string | null
          created_at: string
          updated_at: string
          created_by: string
        }
        Insert: {
          id?: string
          org_id: string
          label: string
          env: 'sandbox' | 'production'
          instance_url: string
          consumer_key: string
          sf_username: string
          status?: 'pending' | 'verified' | 'failed' | 'revoked'
          last_verified_at?: string | null
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
          created_by: string
        }
        Update: {
          id?: string
          org_id?: string
          label?: string
          env?: 'sandbox' | 'production'
          instance_url?: string
          consumer_key?: string
          sf_username?: string
          status?: 'pending' | 'verified' | 'failed' | 'revoked'
          last_verified_at?: string | null
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string
        }
        Relationships: []
      }
      jira_connections: {
        Row: {
          id: string
          org_id: string
          user_id: string
          cloud_id: string
          site_url: string
          jira_account_id: string
          status: 'pending' | 'verified' | 'failed' | 'revoked'
          last_verified_at: string | null
          failure_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          cloud_id: string
          site_url: string
          jira_account_id: string
          status?: 'pending' | 'verified' | 'failed' | 'revoked'
          last_verified_at?: string | null
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string
          cloud_id?: string
          site_url?: string
          jira_account_id?: string
          status?: 'pending' | 'verified' | 'failed' | 'revoked'
          last_verified_at?: string | null
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      n8n_connections: {
        Row: {
          id: string
          org_id: string
          mode: 'byo' | 'hosted'
          base_url: string
          status: 'pending' | 'verified' | 'failed' | 'revoked'
          last_verified_at: string | null
          failure_reason: string | null
          created_at: string
          updated_at: string
          created_by: string
        }
        Insert: {
          id?: string
          org_id: string
          mode: 'byo' | 'hosted'
          base_url: string
          status?: 'pending' | 'verified' | 'failed' | 'revoked'
          last_verified_at?: string | null
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
          created_by: string
        }
        Update: {
          id?: string
          org_id?: string
          mode?: 'byo' | 'hosted'
          base_url?: string
          status?: 'pending' | 'verified' | 'failed' | 'revoked'
          last_verified_at?: string | null
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_orgs: {
        Args: {
          user_uuid: string
        }
        Returns: string[]
      }
    }
    Enums: {
      [_ in never]: never
    }
  }
}
