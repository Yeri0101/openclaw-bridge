alter table public.projects
add column if not exists budget_alert_threshold_pct integer not null default 80;
