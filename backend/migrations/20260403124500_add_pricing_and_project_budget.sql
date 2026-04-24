create table if not exists public.model_pricing (
    id uuid primary key default gen_random_uuid(),
    provider text not null default '*',
    model_name text not null,
    input_price_per_1m numeric(12,6) not null default 0,
    output_price_per_1m numeric(12,6) not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (provider, model_name)
);

alter table public.projects
add column if not exists budget_usd numeric(12,2);

alter table public.request_logs
add column if not exists input_cost_usd numeric(14,8) not null default 0,
add column if not exists output_cost_usd numeric(14,8) not null default 0,
add column if not exists total_cost_usd numeric(14,8) not null default 0,
add column if not exists pricing_provider text,
add column if not exists pricing_model_name text,
add column if not exists pricing_input_per_1m numeric(12,6),
add column if not exists pricing_output_per_1m numeric(12,6);
