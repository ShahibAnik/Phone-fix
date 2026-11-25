-- Lean activity log (D021). APPLIED to production 2026-11-24 with owner approval.
-- pf_audit kept a full before/after copy of every record on every save (~69 MB in one month).
-- Now it records only who, what, which record and when, skips no-op saves and counter bumps,
-- and a daily job keeps 60 days. Earlier history was cleared when this was applied.
begin;
truncate public.pf_audit;
alter table public.pf_audit alter column before_data drop not null;
alter table public.pf_audit alter column after_data drop not null;

create or replace function phonefix_private.audit_change()
returns trigger language plpgsql security definer set search_path to '' as $f$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  noise constant text[] := array['updated_at','client_version','modified_by'];
  rid text := coalesce(r->>'record_id', r->>'id', r->>'user_id', r->>'email', r->>'store_id');
  act text := lower(tg_op);
  who text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and (to_jsonb(old) - noise) = (to_jsonb(new) - noise) then return new; end if;
  if tg_op = 'UPDATE' and rid ilike '%counter%' then return new; end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new)->>'deleted' = 'true' and coalesce(to_jsonb(old)->>'deleted','false') <> 'true')
       or (to_jsonb(new)->>'deleted_at' is not null and to_jsonb(old)->>'deleted_at' is null) then act := 'remove'; end if;
    if to_jsonb(new)->>'revoked_at' is not null and to_jsonb(old)->>'revoked_at' is null then act := 'revoke_access'; end if;
  end if;
  select email into who from auth.users where id = auth.uid();
  insert into public.pf_audit(store_id, entity, record_id, action, actor_id, actor_email)
  values (coalesce(r->>'store_id','philadelphia'),
          case when tg_table_name = 'pf_records' then r->>'kind' else tg_table_name end,
          rid, act, auth.uid(), who);
  return coalesce(new, old);
end $f$;

create extension if not exists pg_cron;
select cron.schedule('pf_audit_retention', '15 4 * * *',
  $c$delete from public.pf_audit where occurred_at < now() - interval '60 days'$c$);
commit;
