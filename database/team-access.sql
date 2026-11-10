-- Staged additive migration. Existing business rows are not edited.
begin;
alter table public.pf_members add column if not exists team_role text check(team_role in ('developer','owner','manager','employee'));
alter table public.pf_members add column if not exists display_name text not null default '';
alter table public.pf_members add column if not exists permissions text[];
alter table phonefix_private.invites add column if not exists team_role text check(team_role in ('developer','owner','manager','employee'));
alter table phonefix_private.invites add column if not exists display_name text not null default '';
alter table phonefix_private.invites add column if not exists permissions text[];

create or replace function phonefix_private.can(perm text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pf_members m where m.user_id=auth.uid() and m.store_id='philadelphia' and m.revoked_at is null and
 (coalesce(m.team_role,m.role) in ('developer','owner') or (coalesce(m.team_role,m.role)='manager' and m.permissions is null) or perm=any(coalesce(m.permissions,'{}'::text[]))))
$$;
revoke all on function phonefix_private.can(text) from public,anon;
grant execute on function phonefix_private.can(text) to authenticated;

create table if not exists phonefix_private.pin_credentials (
 user_id uuid primary key references auth.users(id) on delete cascade,
 pin_hash text not null, recovery_hash text not null, version bigint not null default 1,
 attempts integer not null default 0, blocked_until timestamptz, updated_at timestamptz not null default now()
);
alter table phonefix_private.pin_credentials enable row level security;
revoke all on phonefix_private.pin_credentials from public,anon,authenticated;
create table if not exists phonefix_private.pin_sessions (
 user_id uuid not null references auth.users(id) on delete cascade, session_id text not null,
 version bigint not null, expires_at timestamptz not null,
 primary key(user_id,session_id)
);
alter table phonefix_private.pin_sessions enable row level security;
revoke all on phonefix_private.pin_sessions from public,anon,authenticated;

create or replace function phonefix_private.access_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.pf_members; p phonefix_private.pin_credentials; sid text:=auth.jwt()->>'session_id';
begin
 select * into m from public.pf_members where user_id=auth.uid() and revoked_at is null;
 if m.user_id is null then raise exception 'Your store access is not active';end if;
 select * into p from phonefix_private.pin_credentials where user_id=m.user_id;
 return jsonb_build_object('role',coalesce(m.team_role,m.role),'email',m.email,'name',m.display_name,'permissions',m.permissions,'pinSet',p.user_id is not null,'pinVersion',coalesce(p.version,0),'unlocked',p.user_id is null or exists(select 1 from phonefix_private.pin_sessions s where s.user_id=m.user_id and s.session_id=sid and s.version=p.version and s.expires_at>now()),'blockedUntil',p.blocked_until);
end $$;
revoke all on function phonefix_private.access_context() from public,anon;
grant execute on function phonefix_private.access_context() to authenticated;
create or replace function public.pf_access_context() returns jsonb language sql security invoker set search_path='' as $$ select phonefix_private.access_context() $$;
revoke all on function public.pf_access_context() from public,anon;
grant execute on function public.pf_access_context() to authenticated;

-- Hash inputs are SHA-256 digests of the agreed scheme, salted again by bcrypt on the server.
-- Plaintext PIN/recovery codes never enter the database or audit log.
create or replace function phonefix_private.pin_action(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid text:=auth.jwt()->>'session_id'; p phonefix_private.pin_credentials;
 op text:=payload->>'action'; current_hash text:=payload->>'currentHash'; next_hash text:=payload->>'newHash'; recovery text:=payload->>'recoveryHash'; fresh_recovery text:=payload->>'newRecoveryHash'; ok boolean;
begin
 if uid is null or sid is null or phonefix_private.store_role('philadelphia') is null then raise exception 'Sign in with your email first';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into p from phonefix_private.pin_credentials where user_id=uid for update;
 if op='lock' then delete from phonefix_private.pin_sessions where user_id=uid and session_id=sid;return jsonb_build_object('ok',true);end if;
 if op not in ('setup','unlock','change','recover') then raise exception 'Unknown PIN action';end if;
 if p.blocked_until>clock_timestamp() then return jsonb_build_object('ok',false,'error','Too many attempts. Wait one minute before trying again.','blockedUntil',p.blocked_until);end if;
 if op='setup' then
  if p.user_id is not null then raise exception 'A PIN already exists. Use Change my PIN';end if;
 else
  if p.user_id is null then raise exception 'Set your PIN first';end if;
  if op='recover' then ok:=recovery ~ '^[a-f0-9]{64}$' and extensions.crypt(recovery,p.recovery_hash)=p.recovery_hash;
  else ok:=current_hash ~ '^[a-f0-9]{64}$' and extensions.crypt(current_hash,p.pin_hash)=p.pin_hash;end if;
  if not coalesce(ok,false) then
   update phonefix_private.pin_credentials set attempts=case when blocked_until is not null and blocked_until<=clock_timestamp() then 1 else attempts+1 end,
    blocked_until=case when (case when blocked_until is not null and blocked_until<=clock_timestamp() then 0 else attempts end)+1>=5 then clock_timestamp()+interval '1 minute' else null end where user_id=uid;
   return jsonb_build_object('ok',false,'error','Incorrect PIN or recovery code. Five wrong attempts lock this account for one minute.');
  end if;
 end if;
 if op in ('setup','change','recover') then
  if next_hash is null or next_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid new PIN';end if;
  if p.user_id is not null and extensions.crypt(next_hash,p.pin_hash)=p.pin_hash then raise exception 'Choose a different PIN';end if;
  if op='setup' then
   if fresh_recovery is null or fresh_recovery !~ '^[a-f0-9]{64}$' then raise exception 'Invalid recovery code';end if;
   insert into phonefix_private.pin_credentials(user_id,pin_hash,recovery_hash) values(uid,extensions.crypt(next_hash,extensions.gen_salt('bf')),extensions.crypt(fresh_recovery,extensions.gen_salt('bf')));
  else
   update phonefix_private.pin_credentials set pin_hash=extensions.crypt(next_hash,extensions.gen_salt('bf')),version=version+1,attempts=0,blocked_until=null,updated_at=clock_timestamp() where user_id=uid;
  end if;
 end if;
 update phonefix_private.pin_credentials set attempts=0,blocked_until=null where user_id=uid returning * into p;
 insert into phonefix_private.pin_sessions(user_id,session_id,version,expires_at) values(uid,sid,p.version,clock_timestamp()+interval '30 days')
 on conflict(user_id,session_id) do update set version=excluded.version,expires_at=excluded.expires_at;
 return jsonb_build_object('ok',true,'version',p.version);
end $$;
revoke all on function phonefix_private.pin_action(jsonb) from public,anon;
grant execute on function phonefix_private.pin_action(jsonb) to authenticated;
create or replace function public.pf_pin_action(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select phonefix_private.pin_action(payload) $$;
revoke all on function public.pf_pin_action(jsonb) from public,anon;
grant execute on function public.pf_pin_action(jsonb) to authenticated;

create or replace function phonefix_private.team_list() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not phonefix_private.can('team_manage') then raise exception 'You don''t have permission for this.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('email',coalesce(m.email,i.email),'name',coalesce(nullif(m.display_name,''),i.display_name,''),'role',coalesce(m.team_role,i.team_role,m.role,i.role),'permissions',coalesce(m.permissions,i.permissions),'user_id',m.user_id,'active',m.revoked_at is null,'created_at',m.created_at,'updated_at',m.updated_at,'status',case when m.revoked_at is not null then 'Inactive' when m.user_id is null then 'Awaiting signup' else 'Active' end)) from public.pf_members m full join phonefix_private.invites i on lower(m.email)=i.email and m.store_id=i.store_id where coalesce(m.store_id,i.store_id)='philadelphia'),'[]');
end $$;
revoke all on function phonefix_private.team_list() from public,anon;
grant execute on function phonefix_private.team_list() to authenticated;
create or replace function public.pf_team_list() returns jsonb language sql security invoker set search_path='' as $$ select phonefix_private.team_list() $$;
revoke all on function public.pf_team_list() from public,anon;
grant execute on function public.pf_team_list() to authenticated;

create or replace function phonefix_private.team_save(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare actor public.pf_members; target public.pf_members; oldrole text; newrole text:=payload->>'role'; mail text:=lower(trim(payload->>'email')); perms text[]; active boolean:=coalesce((payload->>'active')::boolean,true); previous jsonb;
begin
 select * into actor from public.pf_members where user_id=auth.uid() and revoked_at is null;
 if not phonefix_private.can('team_manage') or coalesce(actor.team_role,actor.role) not in ('developer','owner','manager') then raise exception 'You don''t have permission for this.';end if;
 if mail='anikshahib@gmail.com' or newrole='developer' then raise exception 'The Developer account is permanent and cannot be edited';end if;
 if mail is null or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email';end if;
 perform pg_advisory_xact_lock(hashtextextended(mail,0));
 select * into target from public.pf_members where lower(email)=mail and store_id='philadelphia' for update;
 previous:=to_jsonb(target);
 select coalesce(target.team_role,target.role,i.team_role,i.role) into oldrole from (select 1) dummy left join phonefix_private.invites i on i.email=mail;
 if target.user_id=auth.uid() then raise exception 'You cannot change your own role or access';end if;
 if coalesce(actor.team_role,actor.role)='manager' and (coalesce(oldrole,'employee')<>'employee' or newrole<>'employee') then raise exception 'Managers can manage employees only';end if;
 if oldrole='developer' then raise exception 'The Developer account is permanent and cannot be edited';end if;
 if newrole is null or newrole not in ('owner','manager','employee') then raise exception 'Choose a valid role';end if;
 if jsonb_typeof(payload->'permissions')='array' then select coalesce(array_agg(value),'{}') into perms from jsonb_array_elements_text(payload->'permissions');end if;
 if exists(select 1 from unnest(coalesce(perms,'{}')) p where p not in ('intake_create','ticket_edit','ticket_delete','ticket_pay','inventory_manage','costs_view','toorder_manage','history_edit','data_export','team_manage','settings_manage')) then raise exception 'Unknown permission';end if;
 if newrole='employee' and 'team_manage'=any(coalesce(perms,'{}')) then raise exception 'Employees cannot receive team management permission';end if;
 if newrole='owner' then perms:=null;end if;
 if newrole='employee' and perms is null then perms:='{}';end if;
 if payload->>'action'='reset_pin' then
  if target.user_id is null then raise exception 'This person must finish email signup first';end if;
  if coalesce(payload->>'newHash','') !~ '^[a-f0-9]{64}$' or coalesce(payload->>'newRecoveryHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid PIN reset';end if;
  insert into phonefix_private.pin_credentials(user_id,pin_hash,recovery_hash) values(target.user_id,extensions.crypt(payload->>'newHash',extensions.gen_salt('bf')),extensions.crypt(payload->>'newRecoveryHash',extensions.gen_salt('bf')))
  on conflict(user_id) do update set pin_hash=excluded.pin_hash,recovery_hash=excluded.recovery_hash,version=phonefix_private.pin_credentials.version+1,attempts=0,blocked_until=null,updated_at=clock_timestamp();
  delete from phonefix_private.pin_sessions where user_id=target.user_id;
  insert into public.pf_audit(store_id,entity,record_id,action,actor_id,actor_email) values('philadelphia','team',mail,'pin_reset',auth.uid(),actor.email);
  return;
 end if;
 if active then
  insert into phonefix_private.invites(email,role,team_role,display_name,permissions) values(mail,case when newrole in ('owner','manager') then 'manager' else 'employee' end,newrole,left(trim(payload->>'name'),100),perms)
  on conflict(email) do update set role=excluded.role,team_role=excluded.team_role,display_name=excluded.display_name,permissions=excluded.permissions;
 else delete from phonefix_private.invites where email=mail;end if;
 update public.pf_members set role=case when newrole in ('owner','manager') then 'manager' else 'employee' end,team_role=newrole,display_name=left(trim(payload->>'name'),100),permissions=perms,revoked_at=case when active then null else clock_timestamp() end where user_id=target.user_id;
 if not active then delete from phonefix_private.pin_sessions where user_id=target.user_id;end if;
 insert into public.pf_audit(store_id,entity,record_id,action,actor_id,actor_email,before_data,after_data) values('philadelphia','team',mail,case when active then 'team_save' else 'deactivate' end,auth.uid(),actor.email,previous,jsonb_build_object('role',newrole,'name',payload->>'name','active',active,'permissions',perms));
end $$;
revoke all on function phonefix_private.team_save(jsonb) from public,anon;
grant execute on function phonefix_private.team_save(jsonb) to authenticated;
create or replace function public.pf_team_save(payload jsonb) returns void language sql security invoker set search_path='' as $$ select phonefix_private.team_save(payload) $$;
revoke all on function public.pf_team_save(jsonb) from public,anon;
grant execute on function public.pf_team_save(jsonb) to authenticated;

create or replace function phonefix_private.claim_membership() returns setof public.pf_members language plpgsql security definer set search_path='' as $$
declare account_email text;
begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 select lower(email) into account_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if account_email is null then raise exception 'Confirm your email before signing in';end if;
 insert into public.pf_members(user_id,store_id,email,role,team_role,display_name,permissions)
 select auth.uid(),i.store_id,i.email,i.role,i.team_role,i.display_name,i.permissions from phonefix_private.invites i where i.email=account_email on conflict(user_id) do nothing;
 return query select * from public.pf_members where user_id=auth.uid() and revoked_at is null;
end $$;

-- These exact three names/addresses were requested by the user. No passwords or PINs are seeded.
insert into phonefix_private.invites(email,role,team_role,display_name) values
 ('anikshahib@gmail.com','manager','developer','Anik'),
 ('phonefixpenrose@gmail.com','manager','owner','Sojib'),
 ('ricodico50@gmail.com','manager','manager','Kazi')
on conflict(email) do update set role=excluded.role,team_role=excluded.team_role,display_name=excluded.display_name,permissions=null;
update public.pf_members m set role=i.role,team_role=i.team_role,display_name=i.display_name,permissions=null
from phonefix_private.invites i where lower(m.email)=i.email and i.email in ('anikshahib@gmail.com','phonefixpenrose@gmail.com','ricodico50@gmail.com');
-- PIN lock is checked server-side for every new permission-aware operation.
create or replace function phonefix_private.can(perm text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pf_members m where m.user_id=auth.uid() and m.store_id='philadelphia' and m.revoked_at is null
 and (coalesce(m.team_role,m.role) in ('developer','owner') or (coalesce(m.team_role,m.role)='manager' and m.permissions is null) or perm=any(coalesce(m.permissions,'{}'::text[])))
 and (not exists(select 1 from phonefix_private.pin_credentials p where p.user_id=m.user_id) or exists(select 1 from phonefix_private.pin_credentials p join phonefix_private.pin_sessions s on s.user_id=p.user_id and s.version=p.version where p.user_id=m.user_id and s.session_id=auth.jwt()->>'session_id' and s.expires_at>now())))
$$;
create or replace function phonefix_private.record_permission(k text) returns boolean language sql stable security invoker set search_path='' as $$
 select case when k in ('repairs','customers') then phonefix_private.can('intake_create') or phonefix_private.can('ticket_edit') or phonefix_private.can('ticket_pay') or phonefix_private.can('ticket_delete') or phonefix_private.can('history_edit')
 when k='reorder' then phonefix_private.can('toorder_manage')
 when k in ('inventory','parts','accessories','usage','special_orders','store_credit') then phonefix_private.can('inventory_manage')
 when k='device_settings' then phonefix_private.store_role('philadelphia') is not null
 else phonefix_private.can('settings_manage') end
$$;
revoke all on function phonefix_private.record_permission(text) from public,anon;
grant execute on function phonefix_private.record_permission(text) to authenticated;
drop policy records_insert on public.pf_records;
create policy records_insert on public.pf_records for insert to authenticated with check (store_id='philadelphia' and modified_by=auth.uid() and phonefix_private.record_permission(kind));
drop policy records_update on public.pf_records;
create policy records_update on public.pf_records for update to authenticated using (store_id='philadelphia' and phonefix_private.record_permission(kind)) with check(store_id='philadelphia' and modified_by=auth.uid() and phonefix_private.record_permission(kind));
drop policy records_read on public.pf_records;
create policy records_read on public.pf_records for select to authenticated using(store_id='philadelphia' and phonefix_private.record_permission(kind) and (kind not in ('inventory','parts','accessories','usage') or phonefix_private.can('costs_view')));
create or replace function phonefix_private.guard_record_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then return new;end if;
 if new.kind='repairs' then
  if new.deleted and not phonefix_private.can('ticket_delete') then raise exception 'You don''t have permission to delete tickets';end if;
  if tg_op='INSERT' and not (phonefix_private.can('intake_create') or phonefix_private.can('history_edit')) then raise exception 'You don''t have permission to create tickets';end if;
  if tg_op='UPDATE' and old.data is distinct from new.data and not new.deleted and not phonefix_private.can('history_edit') then
   if phonefix_private.can('ticket_pay') and (old.data-'isPaid')=(new.data-'isPaid') then return new;end if;
   if phonefix_private.can('ticket_edit') and (old.data-array['queueStatus','priority','readyBy','readyByLabel','isDelivered','deliveredAt','deliveredDay','statusChangedAt'])=(new.data-array['queueStatus','priority','readyBy','readyByLabel','isDelivered','deliveredAt','deliveredDay','statusChangedAt']) then return new;end if;
   raise exception 'You don''t have permission to edit ticket details';
  end if;
 end if;
 return new;
end $$;
revoke all on function phonefix_private.guard_record_change() from public,anon;
create trigger pf_record_permission_guard before insert or update on public.pf_records for each row execute function phonefix_private.guard_record_change();

-- Retired compatibility RPCs must also honor current team permissions.
do $guard$
declare fname text; src text;
begin
 foreach fname in array array['allow_employee','remove_employee','team_access'] loop
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='phonefix_private' and p.proname=fname;
  if src is null then raise exception 'Expected legacy function % is missing',fname;end if;
  src:=replace(src, 'if auth.uid() is null or phonefix_private.store_role(''philadelphia'') is distinct from ''manager'' then', 'if not phonefix_private.can(''team_manage'') or phonefix_private.store_role(''philadelphia'') is distinct from ''manager'' then');
  execute src;
 end loop;
end $guard$;
commit;
