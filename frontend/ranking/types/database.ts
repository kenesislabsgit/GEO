export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type BrandVisibility = "public" | "private";
export type ScanType = "free" | "manual" | "scheduled";
export type ScanStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type ProviderId =
  | "openai"
  | "openai_search"
  | "claude"
  | "gemini"
  | "perplexity"
  | "bedrock_claude"
  | "bedrock_nova"
  | "bedrock_llama"
  | "bedrock_mistral";
export type Sentiment = "positive" | "neutral" | "negative" | "mixed";
export type ActionStatus = "open" | "in_progress" | "completed" | "dismissed";
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "canceled"
  | "past_due"
  | "inactive"
  | "paused";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Brand = {
  id: string;
  owner_id: string | null;
  name: string;
  canonical_domain: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
  category: string | null;
  target_audience: string | null;
  aliases: string[];
  default_country: string;
  default_language: string;
  visibility: BrandVisibility;
  claimed_at: string | null;
  metadata_confidence: Json | null;
  created_at: string;
  updated_at: string;
};

export type Competitor = {
  id: string;
  brand_id: string;
  name: string;
  domain: string | null;
  aliases: string[];
  created_at: string;
};

export type TrackedPrompt = {
  id: string;
  brand_id: string;
  prompt: string;
  prompt_type: string;
  buyer_stage: string;
  country: string;
  language: string;
  active: boolean;
  is_custom: boolean;
  rationale: string | null;
  created_at: string;
};

export type ScanRun = {
  id: string;
  brand_id: string;
  initiated_by: string | null;
  scan_type: ScanType;
  status: ScanStatus;
  provider_ids: ProviderId[];
  total_queries: number;
  completed_queries: number;
  started_at: string | null;
  completed_at: string | null;
  error_summary: string | null;
  methodology_version: string;
  demo_mode: boolean;
  cancelled_at: string | null;
  /** Optional scan-level overrides for prompt country/language. */
  country: string | null;
  language: string | null;
  // Written when the audit finishes, so a queued or running scan has none.
  summary?: string | null;
  // Where a running audit has got to: the runner's step name and 0-100.
  // The page polls these instead of holding a connection open.
  step?: string | null;
  progress?: number;
  created_at: string;
};

export type QueryResult = {
  id: string;
  scan_run_id: string;
  tracked_prompt_id: string | null;
  provider: ProviderId;
  model: string;
  raw_answer: string;
  answer_summary: string | null;
  brand_mentioned: boolean;
  brand_position: number | null;
  brand_sentiment: Sentiment | null;
  confidence: number | null;
  recommended_brands: Json;
  citations: Json;
  sources: Json;
  claims: Json;
  latency_ms: number | null;
  usage_metadata: Json;
  estimated_cost: number | null;
  error: string | null;
  is_demo: boolean;
  created_at: string;
};

export type ScoreSnapshot = {
  id: string;
  brand_id: string;
  scan_run_id: string;
  overall_score: number;
  mention_score: number;
  position_score: number;
  citation_score: number;
  sentiment_score: number;
  mention_rate: number;
  average_position: number | null;
  share_of_voice: number;
  competitor_scores: Json;
  created_at: string;
};

export type Recommendation = {
  id: string;
  brand_id: string;
  scan_run_id: string;
  title: string;
  explanation: string;
  evidence: Json;
  action_type: string;
  priority: number;
  estimated_impact: string | null;
  affected_prompts: string[];
  suggested_content_brief: Json | null;
  status: ActionStatus;
  created_at: string;
  completed_at: string | null;
};

export type Subscription = {
  id: string;
  user_id: string;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  plan: "founder" | "growth" | "agency";
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
};

export type UsageLedgerEntry = {
  id: string;
  user_id: string | null;
  brand_id: string | null;
  scan_run_id: string | null;
  provider: ProviderId | null;
  operation: string;
  units: number;
  estimated_cost: number;
  billing_period: string;
  created_at: string;
};

export type FreeScanRequest = {
  id: string;
  domain: string;
  normalized_domain: string;
  ip_hash: string | null;
  scan_run_id: string | null;
  created_at: string;
};

export type Alert = {
  id: string;
  user_id: string;
  brand_id: string | null;
  type: string;
  title: string;
  body: string;
  metadata: Json;
  read_at: string | null;
  emailed_at: string | null;
  created_at: string;
};

export type WebhookEvent = {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  payload: Json;
  processed_at: string;
};
