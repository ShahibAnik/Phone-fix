-- Shared store-wide identifiers and owner/developer-only identity changes.
begin;

create table if not exists phonefix_private.identifier_counters (
  counter_key text primary key,
  value bigint not null check (value >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
alter table phonefix_private.identifier_counters enable row level security;
revoke all on phonefix_private.identifier_counters from public, anon, authenticated;

-- Seed from the mirrored records already present. Callers may also supply a
-- higher observed minimum from Google Sheets, so the counter catches up safely.
insert into phonefix_private.identifier_counters(counter_key,value)
select 'ticket:' || to_char(timezone('America/New_York',now()),'YYYYMMDD'),
       coalesce(max(split_part(record_id,'-',3)::bigint),0)
from public.pf_records
where store_id='philadelphia' and kind='repairs' and not deleted
  and record_id ~ ('^FIX-'||to_char(timezone('America/New_York',now()),'YYYYMMDD')||'-[0-9]+$')
on conflict(counter_key) do update set value=greatest(phonefix_private.identifier_counters.value,excluded.value);

insert into phonefix_private.identifier_counters(counter_key,value)
select 'customer',coalesce(max(split_part(record_id,'-',2)::bigint),0)
from public.pf_records
where store_id='philadelphia' and kind='customers' and not deleted
  and record_id ~ '^CUST-[0-9]+$'
on conflict(counter_key) do update set value=greatest(phonefix_private.identifier_counters.value,excluded.value);

create or replace function phonefix_private.reserve_identifier(kind text, minimum_value bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare stamp text; key_name text; next_value bigint;
begin
  if minimum_value < 0 or minimum_value > 99999999 then raise exception 'Invalid identifier minimum'; end if;
  if kind='ticket' then
    stamp:=to_char(timezone('America/New_York',clock_timestamp()),'YYYYMMDD');
    key_name:='ticket:'||stamp;
  elsif kind='customer' then
    if auth.uid() is null or not phonefix_private.can('intake_create') then raise exception 'Active store access is required'; end if;
    key_name:='customer';
  else raise exception 'Unknown identifier type';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(key_name,0));
  insert into phonefix_private.identifier_counters(counter_key,value)
  values(key_name,minimum_value+1)
  on conflict(counter_key) do update set value=greatest(phonefix_private.identifier_counters.value,minimum_value)+1,updated_at=clock_timestamp()
  returning value into next_value;
  if kind='ticket' then
    return jsonb_build_object('id','FIX-'||stamp||'-'||lpad(next_value::text,4,'0'),'stamp',stamp,'seq',next_value);
  end if;
  return jsonb_build_object('id','CUST-'||lpad(next_value::text,4,'0'),'seq',next_value);
end $$;
revoke all on function phonefix_private.reserve_identifier(text,bigint) from public;
grant execute on function phonefix_private.reserve_identifier(text,bigint) to anon,authenticated;

create or replace function public.pf_reserve_ticket_id(minimum_value bigint default 0)
returns jsonb language sql security invoker set search_path='' as $$
  select phonefix_private.reserve_identifier('ticket',minimum_value)
$$;
revoke all on function public.pf_reserve_ticket_id(bigint) from public;
grant execute on function public.pf_reserve_ticket_id(bigint) to anon,authenticated;

create or replace function public.pf_reserve_customer_id(minimum_value bigint default 0)
returns jsonb language sql security invoker set search_path='' as $$
  select phonefix_private.reserve_identifier('customer',minimum_value)
$$;
revoke all on function public.pf_reserve_customer_id(bigint) from public,anon;
grant execute on function public.pf_reserve_customer_id(bigint) to authenticated;

create or replace function phonefix_private.identity_change(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.pf_members; entity_kind text:=payload->>'kind'; operation text:=coalesce(payload->>'action','validate');
 old_id text:=trim(payload->>'oldId'); new_id text:=trim(payload->>'newId'); before_row jsonb; changed_count integer:=0;
begin
  select * into actor from public.pf_members where user_id=auth.uid() and store_id='philadelphia' and revoked_at is null;
  if actor.user_id is null or coalesce(actor.team_role,actor.role) not in ('developer','owner') or not phonefix_private.can('history_edit') then
    raise exception 'Only an unlocked Owner or Developer account can change IDs';
  end if;
  if operation not in ('validate','commit') then raise exception 'Unknown identity action'; end if;
  if entity_kind='ticket' then
    if old_id !~ '^FIX-[0-9]{8}-[0-9]{4,8}$' or new_id !~ '^FIX-[0-9]{8}-[0-9]{4,8}$' then raise exception 'Ticket IDs must use FIX-YYYYMMDD-0001 format'; end if;
  elsif entity_kind='customer' then
    if old_id !~ '^CUST-[0-9]{4,8}$' or new_id !~ '^CUST-[0-9]{4,8}$' then raise exception 'Customer IDs must use CUST-0001 format'; end if;
  else raise exception 'Only Ticket ID and Customer ID can be changed';
  end if;
  if old_id=new_id then return jsonb_build_object('ok',true,'changed',false); end if;
  perform pg_advisory_xact_lock(hashtextextended(entity_kind||':'||old_id,0));
  if entity_kind='ticket' then
    select data into before_row from public.pf_records where store_id='philadelphia' and kind='repairs' and record_id=old_id and not deleted;
    if before_row is null then raise exception 'The original ticket is not present in Supabase'; end if;
    if exists(select 1 from public.pf_records where store_id='philadelphia' and kind='repairs' and record_id=new_id and not deleted) then raise exception 'Ticket ID already exists: %',new_id; end if;
  else
    select data into before_row from public.pf_records where store_id='philadelphia' and kind='customers' and record_id=old_id and not deleted;
    if before_row is null then raise exception 'The original customer profile is not present in Supabase'; end if;
    if exists(select 1 from public.pf_records where store_id='philadelphia' and kind='customers' and record_id=new_id and not deleted) then raise exception 'Customer ID already exists: %',new_id; end if;
  end if;
  if operation='validate' then return jsonb_build_object('ok',true,'changed',true); end if;

  if entity_kind='ticket' then
    update public.pf_records set record_id=new_id,
      data=jsonb_set(jsonb_set(data,'{id}',to_jsonb(new_id),true),'{ticketId}',to_jsonb(new_id),true),
      client_version=greatest(client_version,(extract(epoch from clock_timestamp())*1000)::bigint),updated_at=clock_timestamp(),modified_by=auth.uid()
    where store_id='philadelphia' and kind='repairs' and record_id=old_id and not deleted;
    update public.pf_records set data=jsonb_set(data,'{ticketId}',to_jsonb(new_id),true),
      client_version=greatest(client_version,(extract(epoch from clock_timestamp())*1000)::bigint),updated_at=clock_timestamp(),modified_by=auth.uid()
    where store_id='philadelphia' and kind='usage' and not deleted and data->>'ticketId'=old_id;
    get diagnostics changed_count=row_count;
  else
    update public.pf_records set record_id=new_id,data=jsonb_set(data,'{customerId}',to_jsonb(new_id),true),
      client_version=greatest(client_version,(extract(epoch from clock_timestamp())*1000)::bigint),updated_at=clock_timestamp(),modified_by=auth.uid()
    where store_id='philadelphia' and kind='customers' and record_id=old_id and not deleted;
    update public.pf_records set data=jsonb_set(data,'{customerId}',to_jsonb(new_id),true),
      client_version=greatest(client_version,(extract(epoch from clock_timestamp())*1000)::bigint),updated_at=clock_timestamp(),modified_by=auth.uid()
    where store_id='philadelphia' and kind='repairs' and not deleted and data->>'customerId'=old_id;
    get diagnostics changed_count=row_count;
  end if;
  insert into public.pf_audit(store_id,entity,record_id,action,actor_id,actor_email,before_data,after_data)
  values('philadelphia','identity',new_id,entity_kind||'_id_change',auth.uid(),actor.email,
    jsonb_build_object('id',old_id),jsonb_build_object('id',new_id,'linkedRecords',changed_count));
  return jsonb_build_object('ok',true,'changed',true,'linkedRecords',changed_count);
end $$;
revoke all on function phonefix_private.identity_change(jsonb) from public,anon;
grant execute on function phonefix_private.identity_change(jsonb) to authenticated;

create or replace function public.pf_identity_change(payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select phonefix_private.identity_change(payload) $$;
revoke all on function public.pf_identity_change(jsonb) from public,anon;
grant execute on function public.pf_identity_change(jsonb) to authenticated;

commit;
