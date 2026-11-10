begin;
-- Additive storage: legacy repair, attendance and synchronization tables stay unchanged.
create table public.pf_operations (
 id uuid primary key,store_id text not null default 'philadelphia' check(store_id='philadelphia'),
 kind text not null check(kind in ('sale','attendance','rate','adjustment','payment','note')),
 day date not null,user_id uuid references auth.users(id),data jsonb not null,
 version bigint not null default 1, archived boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by text not null,updated_by text not null,
 synced_version bigint not null default 0,sync_error text,
 check((kind in ('sale','note') and user_id is null) or (kind not in ('sale','note') and user_id is not null))
);
create unique index pf_operations_day_unique on public.pf_operations(store_id,kind,day,coalesce(user_id,'00000000-0000-0000-0000-000000000000'::uuid)) where kind in ('sale','attendance','rate') and not archived;
create index pf_operations_user_day on public.pf_operations(user_id,day);
create table public.pf_operations_audit(id bigint generated always as identity primary key,record_id uuid not null references public.pf_operations(id),actor_email text not null,occurred_at timestamptz not null default now(),before_data jsonb,after_data jsonb);
alter table public.pf_operations enable row level security;
alter table public.pf_operations_audit enable row level security;
revoke all on public.pf_operations,public.pf_operations_audit from public,anon,authenticated;
-- RPC-only access. No direct client read/write grants; each RPC checks active membership and PIN.
create function phonefix_private.operations_actor() returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb;
begin
 a:=phonefix_private.access_context();
 if auth.uid() is null or not coalesce((a->>'unlocked')::boolean,false) then raise exception 'Unlock your workspace first';end if;
 return a;
end $$;
revoke all on function phonefix_private.operations_actor() from public,anon,authenticated;
create function public.pf_operations_list() returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();mgr boolean:=a->>'role' in ('developer','owner','manager');notes boolean:=phonefix_private.can('intake_create') or phonefix_private.can('history_edit') or phonefix_private.can('ticket_edit');
begin
 return jsonb_build_object('records',coalesce((select jsonb_agg(to_jsonb(r) order by r.day desc,r.id) from public.pf_operations r where r.store_id='philadelphia' and (mgr or (r.kind='note' and notes) or (r.kind not in ('sale','note') and r.user_id=auth.uid()))),'[]'::jsonb),'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',m.email,'name',m.display_name,'active',m.revoked_at is null)) from public.pf_members m where m.store_id='philadelphia' and (mgr or m.user_id=auth.uid())),'[]'::jsonb));
end $$;
create function public.pf_operation_save(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();mgr boolean:=a->>'role' in ('developer','owner','manager');
 rid uuid:=(payload->>'id')::uuid;k text:=payload->>'kind';d date:=(payload->>'day')::date;uid uuid:=(payload->>'user_id')::uuid;
 v jsonb:=payload->'data';old public.pf_operations;r public.pf_operations;expected bigint:=(payload->>'expected_version')::bigint;field text;amount numeric;
begin
 if rid is null or d is null or k is null or jsonb_typeof(v) is distinct from 'object' or expected is null then raise exception 'Incomplete record';end if;
 if k not in ('sale','attendance','rate','adjustment','payment','note') then raise exception 'Unknown record type';end if;
 if not mgr and (k<>'note' or not (phonefix_private.can('intake_create') or phonefix_private.can('history_edit') or phonefix_private.can('ticket_edit'))) then raise exception 'Manager access required';end if;
 if k in ('sale','note') then uid:=null;elsif not exists(select 1 from public.pf_members m where m.user_id=uid and m.store_id='philadelphia') then raise exception 'Employee is not a store member';end if;
 if length(coalesce(v->>'description',''))>4000 or length(coalesce(v->>'reason',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
 select * into old from public.pf_operations where id=rid for update;
 if old.id is not null then
  if old.kind<>k or old.user_id is distinct from uid or old.day<>d then raise exception 'Date, employee and record type cannot change on an existing record';end if;
  -- Safe response replay after a lost response; no duplicate payment or audit entry.
  if old.version=expected+1 and old.data=v then return to_jsonb(old);end if;
  if old.version<>expected then raise exception 'This record changed. Refresh and reopen it before saving';end if;
  if length(trim(coalesce(v->>'reason','')))<3 then raise exception 'A correction reason is required';end if;
 elsif expected<>0 then raise exception 'Record no longer exists';end if;
 if k='sale' then
  foreach field in array array['cash','card','other'] loop
   amount:=(v->>field)::numeric;
   if amount is null or amount<0 or amount>10000000000 or amount<>trunc(amount) then raise exception 'Sales amounts must be nonnegative whole cents';end if;
  end loop;
  v:=jsonb_build_object('cash',(v->>'cash')::bigint,'card',(v->>'card')::bigint,'other',(v->>'other')::bigint,'description',coalesce(v->>'description',''),'reason',coalesce(v->>'reason',''));
 elsif k='attendance' then
  if coalesce(v->>'status','') not in ('present','half','absent','off') or d>(now() at time zone 'America/New_York')::date then raise exception 'Choose a valid attendance status and date';end if;
  v:=jsonb_build_object('status',v->>'status','description',coalesce(v->>'description',''),'reason',coalesce(v->>'reason',''));
 elsif k in ('rate','adjustment','payment') then
  amount:=(v->>'amount')::numeric;
  if amount is null or abs(amount)>10000000000 or amount<>trunc(amount) or (k<>'adjustment' and amount<0) or (k='payment' and amount=0) then raise exception 'Invalid amount in cents';end if;
  if k='adjustment' and length(trim(coalesce(v->>'description','')))<1 then raise exception 'Adjustment description required';end if;
  if k='payment' and ((v->>'paid_on')::date is null or (v->>'paid_on')::date>(now() at time zone 'America/New_York')::date or coalesce(v->>'method','') not in ('Cash','Card','Bank transfer','Other')) then raise exception 'Choose a valid payment date and method';end if;
  v:=jsonb_build_object('amount',amount::bigint,'description',coalesce(v->>'description',''),'reason',coalesce(v->>'reason',''))||case when k='payment' then jsonb_build_object('paid_on',payload->'data'->>'paid_on','method',payload->'data'->>'method') else '{}'::jsonb end;
 elsif k='note' then
  if length(trim(coalesce(v->>'description','')))<1 or length(coalesce(v->>'customer_id','')) not between 1 and 160 or coalesce(v->>'phone','') !~ '^[0-9]{7,15}$' or coalesce((v->>'rating')::integer,-1) not between 0 and 5 then raise exception 'Enter customer, phone, issue, and a valid optional rating';end if;
  if old.id is not null and not mgr and (old.data - array['resolved','reason']) is distinct from (v - array['resolved','reason']) then raise exception 'Employees may only resolve or reopen existing notes';end if;
  if not mgr and coalesce((v->>'archived')::boolean,false) then raise exception 'Only managers may archive notes';end if;
  v:=jsonb_build_object('customer_id',v->>'customer_id','name',left(coalesce(v->>'name',''),200),'phone',v->>'phone','ticket_id',left(coalesce(v->>'ticket_id',''),160),'description',v->>'description','rating',(v->>'rating')::integer,'resolved',coalesce((v->>'resolved')::boolean,false),'reason',coalesce(v->>'reason',''))||case when coalesce((v->>'archived')::boolean,false) then '{"archived":true}'::jsonb else '{}'::jsonb end;
 end if;
 if old.id is null then
  insert into public.pf_operations(id,kind,day,user_id,data,created_by,updated_by,archived) values(rid,k,d,uid,v,a->>'email',a->>'email',coalesce((v->>'archived')::boolean,false)) returning * into r;
 else
  update public.pf_operations set data=v,version=version+1,updated_at=now(),updated_by=a->>'email',sync_error=null,archived=coalesce((v->>'archived')::boolean,false) where id=rid returning * into r;
 end if;
 insert into public.pf_operations_audit(record_id,actor_email,before_data,after_data) values(rid,a->>'email',case when old.id is not null then to_jsonb(old) else null end,to_jsonb(r));
 return to_jsonb(r);
end $$;
create function public.pf_operation_history(record_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();r public.pf_operations;
begin
 select * into r from public.pf_operations where id=record_id and store_id='philadelphia';
 if r.id is null or not (a->>'role' in ('developer','owner','manager') or (r.kind not in ('sale','note') and r.user_id=auth.uid()) or (r.kind='note' and (phonefix_private.can('intake_create') or phonefix_private.can('ticket_edit') or phonefix_private.can('history_edit')))) then raise exception 'Access denied';end if;
 return coalesce((select jsonb_agg(to_jsonb(h) order by occurred_at desc) from public.pf_operations_audit h where h.record_id=r.id),'[]'::jsonb);
end $$;
revoke all on function public.pf_operations_list(),public.pf_operation_save(jsonb),public.pf_operation_history(uuid) from public,anon;
grant execute on function public.pf_operations_list(),public.pf_operation_save(jsonb),public.pf_operation_history(uuid) to authenticated;
-- A dedicated scoped token for the management spreadsheet worker (never a service-role key).
create table phonefix_private.operations_sheet_connector(singleton boolean primary key default true check(singleton),token_hash text not null,sheet_id text not null,last_sync_at timestamptz);
alter table phonefix_private.operations_sheet_connector enable row level security;
revoke all on phonefix_private.operations_sheet_connector from public,anon,authenticated;
create function public.pf_operations_sheet_setup() returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();token text:=encode(extensions.gen_random_bytes(32),'hex');
begin
 if a->>'role' not in ('developer','owner') then raise exception 'Owner or developer required';end if;
 insert into phonefix_private.operations_sheet_connector(singleton,token_hash,sheet_id) values(true,encode(extensions.digest(token,'sha256'),'hex'),'1xAIQT635B6m38KxAFCpaJe97Ist4csrwROVoMSECW80') on conflict(singleton) do update set token_hash=excluded.token_hash,sheet_id=excluded.sheet_id;
 return jsonb_build_object('token',token,'sheet_id','1xAIQT635B6m38KxAFCpaJe97Ist4csrwROVoMSECW80');
end $$;
revoke all on function public.pf_operations_sheet_setup() from public,anon;
grant execute on function public.pf_operations_sheet_setup() to authenticated;
create function public.pf_operations_sheet_pull(token text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from phonefix_private.operations_sheet_connector c where c.token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'Invalid connector token';end if;
 return jsonb_build_object('sheet_id','1xAIQT635B6m38KxAFCpaJe97Ist4csrwROVoMSECW80','records',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('employee_email',(select m.email from public.pf_members m where m.user_id=r.user_id and m.store_id=r.store_id))) from (select * from public.pf_operations where synced_version<version order by updated_at,id limit 200) r),'[]'::jsonb));
end $$;
create function public.pf_operations_sheet_ack(token text,records jsonb) returns void language plpgsql security definer set search_path='' as $$
declare x jsonb;
begin
 if not exists(select 1 from phonefix_private.operations_sheet_connector c where c.token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'Invalid connector token';end if;
 if jsonb_array_length(records)>200 then raise exception 'Batch too large';end if;
 for x in select * from jsonb_array_elements(records) loop
  update public.pf_operations set synced_version=greatest(synced_version,least(version,(x->>'version')::bigint)),sync_error=nullif(left(x->>'error',500),'') where id=(x->>'id')::uuid and (x->>'version')::bigint>=0;
 end loop;
 update phonefix_private.operations_sheet_connector set last_sync_at=now() where singleton=true;
end $$;
revoke all on function public.pf_operations_sheet_pull(text),public.pf_operations_sheet_ack(text,jsonb) from public;
grant execute on function public.pf_operations_sheet_pull(text),public.pf_operations_sheet_ack(text,jsonb) to anon,authenticated;
commit;
