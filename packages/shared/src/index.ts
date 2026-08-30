// Ergonomic re-exports on top of the auto-generated Database types.
// Consumers usually want a plain type name (e.g. `Profile`) rather than
// `Database['public']['Tables']['profiles']['Row']`. Kept in this file
// (not database.ts) so it survives full regenerations of that file.

import type { Database } from './database';

export type { Database, Json } from './database';

export type MatchStatus = Database['public']['Enums']['match_status'];

export type Profile           = Database['public']['Tables']['profiles']['Row'];
export type ProfileInsert     = Database['public']['Tables']['profiles']['Insert'];
export type ProfileUpdate     = Database['public']['Tables']['profiles']['Update'];

export type Match             = Database['public']['Tables']['matches']['Row'];
export type MatchInsert       = Database['public']['Tables']['matches']['Insert'];

export type MatchHistory      = Database['public']['Tables']['match_history']['Row'];

export type Message           = Database['public']['Tables']['messages']['Row'];
export type MessageInsert     = Database['public']['Tables']['messages']['Insert'];

export type Report            = Database['public']['Tables']['reports']['Row'];

export type UniversityConfig  = Database['public']['Tables']['university_config']['Row'];

export type AdminAllowlist    = Database['public']['Tables']['admin_allowlist']['Row'];
