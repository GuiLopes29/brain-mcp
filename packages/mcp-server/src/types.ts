export type KnowledgeKind = 'solution' | 'rule' | 'pitfall' | 'decision';
export type KnowledgeStatus = 'active' | 'deprecated';
export type KnowledgeReviewStatus = 'reviewed' | 'pending_review' | 'auto_classified';

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  project: string;
  source: string;
  problem?: string;
  kind?: KnowledgeKind;
  directive?: string;
  /** Lifecycle — deprecated items are excluded from get_guidelines. */
  status?: KnowledgeStatus;
  /** UUID of the item that superseded this one (for audit trail). */
  superseded_by?: string;
  /** 1 (critical, always surfaces) to 5 (low, may be cut at limit). Default 3. */
  priority?: number;
  /** reviewed = manual/trusted; auto_classified = model agreed; pending_review = model unavailable. */
  review_status?: KnowledgeReviewStatus;
  created_at: string;
  updated_at?: string;
  last_accessed_at?: string;
  access_count: number;
}

export interface KnowledgeSearchResult extends KnowledgeItem {
  similarity: number;
}

export interface GraphNode {
  id: string;
  title: string;
  content: string;
  project: string;
  source: string;
  problem?: string;
  kind?: KnowledgeKind;
  directive?: string;
  tags: string[];
  created_at: string;
  updated_at?: string;
  last_accessed_at?: string;
  access_count: number;
  val: number;
  color: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  sharedTags: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}
