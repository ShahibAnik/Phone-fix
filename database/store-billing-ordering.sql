-- Record completion order after stock locks, including concurrent sales.
alter table public.pf_trade_entries alter column created_at set default clock_timestamp();
create index pf_trade_pending_stock on public.pf_trade_entries(source_kind,source_id) where not synced;
create index pf_trade_account_day on public.pf_trade_entries(account_id,day,created_at);
