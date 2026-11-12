-- Granular authorization. Existing roles and permission arrays remain intact.
-- Legacy permission names are interpreted as compatibility bundles.

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

create or replace function phonefix_private.record_permission(k text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case
  when k='repairs' then phonefix_private.can('repair_view') or phonefix_private.can('repair_create') or phonefix_private.can('repair_edit') or phonefix_private.can('repair_status') or phonefix_private.can('payment_record') or phonefix_private.can('repair_delete')
  when k='customers' then phonefix_private.can('customer_history_view') or phonefix_private.can('customer_edit') or phonefix_private.can('repair_create')
  when k='reorder' then phonefix_private.can('orders_manage')
  when k in ('inventory','parts','accessories','usage') then phonefix_private.can('inventory_view') or phonefix_private.can('inventory_add') or phonefix_private.can('inventory_edit') or phonefix_private.can('inventory_delete')
  when k in ('special_orders','store_credit') then phonefix_private.can('orders_manage') or phonefix_private.can('payment_record')
  when k='device_settings' then phonefix_private.store_role('philadelphia') is not null
  else phonefix_private.can('settings_manage') end
$$;

create or replace function phonefix_private.guard_record_change() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then return new; end if;
 if new.kind='repairs' then
  if tg_op='INSERT' and not phonefix_private.can('repair_create') then raise exception 'Repair creation permission required'; end if;
  if tg_op='UPDATE' then
   if new.deleted and not old.deleted and not phonefix_private.can('repair_delete') then raise exception 'Repair deletion permission required'; end if;
   if old.data is distinct from new.data and not new.deleted then
    if phonefix_private.can('payment_record') and (old.data-array['isPaid','payments','paymentStatus'])=(new.data-array['isPaid','payments','paymentStatus']) then return new; end if;
    if phonefix_private.can('technician_assign') and (old.data-'fixedBy')=(new.data-'fixedBy') then return new; end if;
    if phonefix_private.can('repair_status') and (old.data-array['queueStatus','priority','readyBy','readyByLabel','isDelivered','deliveredAt','deliveredDay','statusChangedAt'])=(new.data-array['queueStatus','priority','readyBy','readyByLabel','isDelivered','deliveredAt','deliveredDay','statusChangedAt']) then return new; end if;
    if not phonefix_private.can('repair_edit') then raise exception 'Repair edit permission required'; end if;
   end if;
  end if;
 elsif new.kind='customers' then
  if tg_op='INSERT' and not phonefix_private.can('repair_create') then raise exception 'Repair creation permission required'; end if;
  if tg_op='UPDATE' and not phonefix_private.can('customer_edit') then raise exception 'Customer edit permission required'; end if;
 elsif new.kind in ('inventory','parts','accessories','usage') then
  if tg_op='INSERT' and not phonefix_private.can('inventory_add') then raise exception 'Inventory add permission required'; end if;
  if tg_op='UPDATE' and new.deleted and not old.deleted and not phonefix_private.can('inventory_delete') then raise exception 'Inventory delete permission required'; end if;
  if tg_op='UPDATE' and not new.deleted and old.data is distinct from new.data and not phonefix_private.can('inventory_edit') then raise exception 'Inventory edit permission required'; end if;
 elsif new.kind in ('reorder','special_orders','store_credit') and not phonefix_private.can('orders_manage') and not phonefix_private.can('payment_record') then
  raise exception 'Order management permission required';
 end if;
 return new;
end $$;

drop policy if exists records_read on public.pf_records;
create policy records_read on public.pf_records for select to authenticated using(
 store_id='philadelphia' and case
  when kind='repairs' then phonefix_private.can('repair_view') or phonefix_private.can('repair_create')
  when kind='customers' then phonefix_private.can('customer_history_view') or phonefix_private.can('customer_edit') or phonefix_private.can('repair_create')
  when kind in ('inventory','parts','accessories','usage') then phonefix_private.can('inventory_view')
  when kind in ('reorder','special_orders','store_credit') then phonefix_private.can('orders_manage') or phonefix_private.can('payment_record')
  else phonefix_private.record_permission(kind) end
);

-- Team lists may be read with team_view. Only Owner/Developer may change grants.
create or replace function phonefix_private.team_list() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not (phonefix_private.can('team_view') or phonefix_private.can('team_manage')) then raise exception 'Team view permission required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('email',coalesce(m.email,i.email),'name',coalesce(nullif(m.display_name,''),i.display_name,''),'role',coalesce(m.team_role,i.team_role,m.role,i.role),'permissions',coalesce(m.permissions,i.permissions),'user_id',m.user_id,'active',m.revoked_at is null,'created_at',m.created_at,'updated_at',m.updated_at,'status',case when m.revoked_at is not null then 'Inactive' when m.user_id is null then 'Awaiting signup' else 'Active' end)) from public.pf_members m full join phonefix_private.invites i on lower(m.email)=i.email and m.store_id=i.store_id where coalesce(m.store_id,i.store_id)='philadelphia'),'[]');
end $$;

do $upgrade$
declare src text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='phonefix_private' and p.proname='team_save' and pg_get_function_identity_arguments(p.oid)='payload jsonb';
 src:=replace(src,$from$not in ('developer', 'owner', 'manager')$from$,$to$not in ('developer', 'owner')$to$);
 src:=replace(src,$from$not in ('developer','owner','manager')$from$,$to$not in ('developer','owner')$to$);
 src:=replace(src,$from$'intake_create', 'ticket_edit', 'ticket_delete', 'ticket_pay', 'inventory_manage', 'costs_view', 'toorder_manage', 'history_edit', 'data_export', 'team_manage', 'settings_manage'$from$,$to$'intake_create','ticket_edit','ticket_delete','ticket_pay','inventory_manage','costs_view','toorder_manage','history_edit','data_export','team_manage','settings_manage','repair_create','repair_view','repair_edit','repair_delete','repair_status','technician_assign','customer_history_view','customer_edit','payment_record','refund_issue','discount_apply','financial_reports_view','daily_closing_submit','daily_closing_edit','inventory_view','inventory_add','inventory_edit','inventory_delete','suppliers_view','orders_manage','attendance_view','attendance_own','attendance_edit','team_view','audit_view'$to$);
 src:=replace(src,$from$'intake_create','ticket_edit','ticket_delete','ticket_pay','inventory_manage','costs_view','toorder_manage','history_edit','data_export','team_manage','settings_manage'$from$,$to$'intake_create','ticket_edit','ticket_delete','ticket_pay','inventory_manage','costs_view','toorder_manage','history_edit','data_export','team_manage','settings_manage','repair_create','repair_view','repair_edit','repair_delete','repair_status','technician_assign','customer_history_view','customer_edit','payment_record','refund_issue','discount_apply','financial_reports_view','daily_closing_submit','daily_closing_edit','inventory_view','inventory_add','inventory_edit','inventory_delete','suppliers_view','orders_manage','attendance_view','attendance_own','attendance_edit','team_view','audit_view'$to$);
 execute src;
end $upgrade$;

revoke all on function phonefix_private.can(text) from public,anon;
grant execute on function phonefix_private.can(text) to authenticated;
revoke all on function phonefix_private.team_save(jsonb) from public,anon,authenticated;
