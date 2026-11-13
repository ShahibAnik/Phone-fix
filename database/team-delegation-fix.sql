-- Fix the invoker wrapper's missing EXECUTE grant and bound manager delegation.
create or replace function phonefix_private.permission_in_set(perm text, grants text[]) returns boolean
language sql immutable security invoker set search_path='' as $$ select perm=any(coalesce(grants,'{}'::text[])) or ('intake_create'=any(coalesce(grants,'{}'::text[])) and perm=any(array['repair_create'])) or ('ticket_edit'=any(coalesce(grants,'{}'::text[])) and perm=any(array['repair_edit','repair_status','technician_assign'])) or ('ticket_delete'=any(coalesce(grants,'{}'::text[])) and perm=any(array['repair_delete'])) or ('ticket_pay'=any(coalesce(grants,'{}'::text[])) and perm=any(array['payment_record'])) or ('inventory_manage'=any(coalesce(grants,'{}'::text[])) and perm=any(array['inventory_view','inventory_add','inventory_edit','inventory_delete','orders_manage'])) or ('toorder_manage'=any(coalesce(grants,'{}'::text[])) and perm=any(array['orders_manage'])) or ('history_edit'=any(coalesce(grants,'{}'::text[])) and perm=any(array['repair_view','repair_edit','customer_history_view','customer_edit'])) or ('costs_view'=any(coalesce(grants,'{}'::text[])) and perm=any(array['financial_reports_view'])) or ('team_manage'=any(coalesce(grants,'{}'::text[])) and perm=any(array['team_view'])) $$;
revoke all on function phonefix_private.permission_in_set(text,text[]) from public,anon,authenticated;
create or replace function phonefix_private.team_save(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare actor public.pf_members; target public.pf_members; oldrole text; newrole text:=payload->>'role'; mail text:=lower(trim(payload->>'email')); perms text[]; active boolean:=coalesce((payload->>'active')::boolean,true); previous jsonb;
begin
 select * into actor from public.pf_members where user_id=auth.uid() and store_id='philadelphia' and revoked_at is null for update;
 if not phonefix_private.can('team_manage') or coalesce(actor.team_role,actor.role) not in ('developer','owner','manager') then raise exception 'You don''t have permission for this.';end if;
 if mail='anikshahib@gmail.com' or newrole='developer' then raise exception 'The Developer account is permanent and cannot be edited';end if;
 if mail is null or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email';end if;
 perform pg_advisory_xact_lock(hashtextextended(mail,0));
 select * into target from public.pf_members where lower(email)=mail and store_id='philadelphia' for update;
 previous:=to_jsonb(target);
 select coalesce(target.team_role,target.role,i.team_role,i.role) into oldrole from (select 1) dummy left join phonefix_private.invites i on i.email=mail and i.store_id='philadelphia';
 if target.user_id=auth.uid() then raise exception 'You cannot change your own role or access';end if;
 if coalesce(actor.team_role,actor.role)='manager' and (coalesce(oldrole,'employee')<>'employee' or newrole<>'employee') then raise exception 'Managers can manage employees only';end if;
 if oldrole='developer' then raise exception 'The Developer account is permanent and cannot be edited';end if;
 if newrole is null or newrole not in ('owner','manager','employee') then raise exception 'Choose a valid role';end if;
 if jsonb_typeof(payload->'permissions')='array' then select coalesce(array_agg(value),'{}') into perms from jsonb_array_elements_text(payload->'permissions');end if;
 if exists(select 1 from unnest(coalesce(perms,'{}')) p where p not in ('repair_create','repair_view','repair_edit','repair_delete','repair_status','technician_assign','customer_history_view','customer_edit','payment_record','refund_issue','discount_apply','financial_reports_view','costs_view','daily_closing_submit','daily_closing_edit','inventory_view','inventory_add','inventory_edit','inventory_delete','suppliers_view','orders_manage','attendance_view','attendance_own','attendance_edit','team_view','team_manage','settings_manage','data_export','audit_view','intake_create','ticket_edit','ticket_delete','ticket_pay','inventory_manage','toorder_manage','history_edit')) then raise exception 'Unknown permission';end if;
 if newrole='employee' and 'team_manage'=any(coalesce(perms,'{}')) then raise exception 'Employees cannot receive team management permission';end if;
 if newrole='owner' then perms:=null;end if;
 if newrole='employee' and perms is null then perms:='{}';end if;
 if coalesce(actor.team_role,actor.role)='manager' then
  if payload->>'action'='reset_pin' then raise exception 'Only Owner or Developer can reset another person''s PIN'; end if;
  -- Preserve all permissions outside the manager's delegation scope.
  if exists (
   select 1 from unnest(array['repair_create','repair_view','repair_edit','repair_delete','repair_status','technician_assign','customer_history_view','customer_edit','payment_record','refund_issue','discount_apply','financial_reports_view','costs_view','daily_closing_submit','daily_closing_edit','inventory_view','inventory_add','inventory_edit','inventory_delete','suppliers_view','orders_manage','attendance_view','attendance_own','attendance_edit','team_view','team_manage','settings_manage','data_export','audit_view']::text[]) p
   where p<>'attendance_own' and not phonefix_private.can(p) and
    (phonefix_private.permission_in_set(p,perms) is distinct from
     phonefix_private.permission_in_set(p,coalesce(target.permissions,(select i.permissions from phonefix_private.invites i where i.email=mail and i.store_id='philadelphia'),'{}'::text[])))
  ) then raise exception 'Managers can change only permissions they already have'; end if;
 end if;
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


-- Retired endpoints must not bypass bounded manager delegation.
do $guard$
declare fname text; src text;
begin
 foreach fname in array array['allow_employee','remove_employee'] loop
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='phonefix_private' and p.proname=fname;
  if src is null then raise exception 'Missing legacy endpoint %',fname;end if;
  src:=replace(src, 'if not phonefix_private.can(''team_manage'')', 'if not exists(select 1 from public.pf_members where user_id=auth.uid() and revoked_at is null and coalesce(team_role,role) in (''owner'',''developer'')) or not phonefix_private.can(''team_manage'')');
  execute src;
 end loop;
end $guard$;
