-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Matches OpenAI text-embedding-3-small (1536 dimensions).

create extension if not exists vector;

create table if not exists documents (
  id bigserial primary key,
  content text,
  metadata jsonb,
  embedding vector(1536)
);

create or replace function match_documents (
  query_embedding vector(1536),
  match_count int default null,
  filter jsonb default '{}'
) returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
  select
    id,
    content,
    metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;

create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Comment log: one row per YouTube comment the bot handled.
-- Feeds the human-review queue and (later) the dashboard.
--   status: replied | drafted (posting node disabled) | needs_human | skipped | error | discarded
-- Run this part once in the Supabase SQL Editor.
-- ---------------------------------------------------------------------------
create table if not exists comment_log (
  id bigserial primary key,
  comment_id text unique not null,
  video_id text,
  author text,
  comment text,
  published_at timestamptz,
  category text,
  confidence numeric,
  reason text,
  reply text,
  status text not null,
  youtube_reply_id text,
  error_message text,
  handled boolean not null default false,   -- a human ticks this when done
  created_at timestamptz not null default now()
);

create index if not exists comment_log_status_idx on comment_log (status, created_at desc);
