alter table public.request_logs
add column if not exists prompt_tokens integer not null default 0,
add column if not exists completion_tokens integer not null default 0;

update public.request_logs
set prompt_tokens = total_tokens,
    completion_tokens = 0
where coalesce(prompt_tokens, 0) = 0
  and coalesce(completion_tokens, 0) = 0
  and coalesce(total_tokens, 0) > 0;
