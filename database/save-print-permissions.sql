-- Staff reservation permissions; deploy with public-checkin.sql and the updated intake page.
-- Function/grant changes only. No business rows, counters, membership grants or RLS policies are rewritten.
begin;
create or replace function phonefix_private.can(perm text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.pf_members m
  where m.user_id=auth.uid() and m.store_id='philadelphia' and m.revoked_at is null
  and (
   coalesce(m.team_role,m.role) in ('developer','owner')
   or coalesce(m.team_role,m.role)='manager' and m.permissions is null
   or coalesce(m.team_role,m.role)='employee' and perm='attendance_own'
   or perm=any(coalesce(m.permissions,'{}'::text[]))
   or case perm
    when 'intake_create' then 'repair_create'=any(coalesce(m.permissions,'{}'))
    when 'repair_create' then 'intake_create'=any(coalesce(m.permissions,'{}'))
    when 'repair_view' then 'history_edit'=any(coalesce(m.permissions,'{}'))
    when 'repair_edit' then 'history_edit'=any(coalesce(m.permissions,'{}')) or 'ticket_edit'=any(coalesce(m.permissions,'{}'))
    when 'repair_delete' then 'ticket_delete'=any(coalesce(m.permissions,'{}'))
    when 'repair_status' then 'ticket_edit'=any(coalesce(m.permissions,'{}'))
    when 'technician_assign' then 'ticket_edit'=any(coalesce(m.permissions,'{}'))
    when 'customer_history_view' then 'history_edit'=any(coalesce(m.permissions,'{}'))
    when 'customer_edit' then 'history_edit'=any(coalesce(m.permissions,'{}'))
    when 'payment_record' then 'ticket_pay'=any(coalesce(m.permissions,'{}'))
    when 'inventory_view' then 'inventory_manage'=any(coalesce(m.permissions,'{}'))
    when 'inventory_add' then 'inventory_manage'=any(coalesce(m.permissions,'{}'))
    when 'inventory_edit' then 'inventory_manage'=any(coalesce(m.permissions,'{}'))
    when 'inventory_delete' then 'inventory_manage'=any(coalesce(m.permissions,'{}'))
    when 'orders_manage' then 'toorder_manage'=any(coalesce(m.permissions,'{}')) or 'inventory_manage'=any(coalesce(m.permissions,'{}'))
    when 'financial_reports_view' then 'costs_view'=any(coalesce(m.permissions,'{}'))
    when 'team_view' then 'team_manage'=any(coalesce(m.permissions,'{}'))
    when 'audit_view' then 'history_edit'=any(coalesce(m.permissions,'{}')) and 'costs_view'=any(coalesce(m.permissions,'{}'))
    else false end
  )
  and (not exists(select 1 from phonefix_private.pin_credentials p where p.user_id=m.user_id)
    or exists(select 1 from phonefix_private.pin_credentials p join phonefix_private.pin_sessions s on s.user_id=p.user_id and s.version=p.version where p.user_id=m.user_id and s.session_id=auth.jwt()->>'session_id' and s.expires_at>now()))
 )
$$;

revoke all on function phonefix_private.can(text) from public,anon;
grant execute on function phonefix_private.can(text) to authenticated;

create or replace function phonefix_private.allocate_identifier(kind text, minimum_value bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare stamp text; key_name text; next_value bigint;
begin
  if kind is null or kind not in ('ticket','customer') then raise exception 'Unknown identifier type'; end if;
  if minimum_value is null or minimum_value < 0 or minimum_value > 99999999 then raise exception 'Invalid identifier minimum'; end if;
  if kind='ticket' then
    stamp:=to_char(timezone('America/New_York',clock_timestamp()),'YYYYMMDD');
    key_name:='ticket:'||stamp;
  elsif kind='customer' then
    key_name:='customer';
  else raise exception 'Unknown identifier type';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(key_name,0));
  insert into phonefix_private.identifier_counters(counter_key,value)
  values(key_name,minimum_value+1)
  on conflict(counter_key) do update set value=greatest(phonefix_private.identifier_counters.value,minimum_value)+1,updated_at=clock_timestamp()
  returning value into next_value;
  if kind='ticket' then
    return jsonb_build_object('id','FIX-'||stamp||'-'||lpad(next_value::text,greatest(4,length(next_value::text)),'0'),'stamp',stamp,'seq',next_value);
  end if;
  return jsonb_build_object('id','CUST-'||lpad(next_value::text,greatest(4,length(next_value::text)),'0'),'seq',next_value);
end $$;
revoke all on function phonefix_private.allocate_identifier(text,bigint) from public,anon,authenticated;

create or replace function phonefix_private.reserve_identifier(kind text, minimum_value bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if kind is null or kind not in ('ticket','customer') then raise exception 'Unknown identifier type'; end if;
 if auth.uid() is null or not phonefix_private.can('repair_create') then
  raise exception using errcode='42501', message=initcap(kind)||' ID reservation denied: repair_create permission and an unlocked active store account are required';
 end if;
 return phonefix_private.allocate_identifier(kind,minimum_value);
end $$;
revoke all on function phonefix_private.reserve_identifier(text,bigint) from public,anon;
grant execute on function phonefix_private.reserve_identifier(text,bigint) to authenticated;

create or replace function public.pf_reserve_ticket_id(minimum_value bigint default 0)
returns jsonb language sql security invoker set search_path='' as $$
  select phonefix_private.reserve_identifier('ticket',minimum_value)
$$;
revoke all on function public.pf_reserve_ticket_id(bigint) from public,anon;
grant execute on function public.pf_reserve_ticket_id(bigint) to authenticated;

create or replace function public.pf_reserve_customer_id(minimum_value bigint default 0)
returns jsonb language sql security invoker set search_path='' as $$
  select phonefix_private.reserve_identifier('customer',minimum_value)
$$;
revoke all on function public.pf_reserve_customer_id(bigint) from public,anon;
grant execute on function public.pf_reserve_customer_id(bigint) to authenticated;

commit;
