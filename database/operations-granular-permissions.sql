-- Apply granular permissions to daily sales, attendance, payroll and customer flags.

create or replace function public.pf_operations_list() returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();
begin
 return jsonb_build_object(
  'records',coalesce((select jsonb_agg(to_jsonb(r) order by r.day desc,r.id) from public.pf_operations r where r.store_id='philadelphia' and (
   r.kind='sale' and (phonefix_private.can('financial_reports_view') or phonefix_private.can('daily_closing_submit') or phonefix_private.can('daily_closing_edit'))
   or r.kind='note' and (phonefix_private.can('customer_history_view') or phonefix_private.can('customer_edit') or phonefix_private.can('repair_create'))
   or r.kind not in ('sale','note') and (phonefix_private.can('attendance_view') or phonefix_private.can('attendance_edit') or r.user_id=auth.uid() and phonefix_private.can('attendance_own'))
  )),'[]'::jsonb),
  'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',m.email,'name',m.display_name,'active',m.revoked_at is null)) from public.pf_members m where m.store_id='philadelphia' and (phonefix_private.can('attendance_view') or phonefix_private.can('attendance_edit') or phonefix_private.can('team_view') or m.user_id=auth.uid())),'[]'::jsonb)
 );
end $$;

do $upgrade$
declare src text; old_guard text:=$old$if not mgr and (k<>'note' or not (phonefix_private.can('intake_create') or phonefix_private.can('history_edit') or phonefix_private.can('ticket_edit'))) then raise exception 'Manager access required';end if;$old$;
new_guard text:=$new$if k='sale' then
  if exists(select 1 from public.pf_operations x where x.id=rid) and not phonefix_private.can('daily_closing_edit') then raise exception 'Prior closing edit permission required';end if;
  if not exists(select 1 from public.pf_operations x where x.id=rid) and not phonefix_private.can('daily_closing_submit') then raise exception 'Daily closing submission permission required';end if;
 elsif k='attendance' then
  if not phonefix_private.can('attendance_edit') and not (uid=auth.uid() and phonefix_private.can('attendance_own')) then raise exception 'Attendance permission required';end if;
 elsif k in ('rate','adjustment','payment') then
  if not phonefix_private.can('attendance_edit') then raise exception 'Payroll edit permission required';end if;
 elsif k='note' and not (phonefix_private.can('customer_history_view') or phonefix_private.can('customer_edit') or phonefix_private.can('repair_create')) then raise exception 'Customer note permission required';
 end if;$new$;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='pf_operation_save' and pg_get_function_identity_arguments(p.oid)='payload jsonb';
 if position(old_guard in src)=0 then raise exception 'Could not locate operation permission guard';end if;
 execute replace(src,old_guard,new_guard);
end $upgrade$;

create or replace function public.pf_operation_history(record_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();r public.pf_operations;
begin
 select * into r from public.pf_operations where id=record_id and store_id='philadelphia';
 if r.id is null or not (
  phonefix_private.can('audit_view')
  or r.kind='sale' and (phonefix_private.can('financial_reports_view') or phonefix_private.can('daily_closing_edit'))
  or r.kind='note' and (phonefix_private.can('customer_history_view') or phonefix_private.can('customer_edit'))
  or r.kind not in ('sale','note') and (phonefix_private.can('attendance_view') or phonefix_private.can('attendance_edit') or r.user_id=auth.uid() and phonefix_private.can('attendance_own'))
 ) then raise exception 'Access denied';end if;
 return coalesce((select jsonb_agg(to_jsonb(h) order by occurred_at desc) from public.pf_operations_audit h where h.record_id=r.id),'[]'::jsonb);
end $$;

create or replace function public.pf_daily_sale_save(payload jsonb,employee_ids jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor jsonb:=phonefix_private.operations_actor();sale jsonb;attendance jsonb:='[]'::jsonb;uid uuid;existing public.pf_operations;day_value date:=(payload->>'day')::date;
begin
 if exists(select 1 from public.pf_operations x where x.id=(payload->>'id')::uuid) then
  if not phonefix_private.can('daily_closing_edit') then raise exception 'Prior closing edit permission required';end if;
 else
  if not phonefix_private.can('daily_closing_submit') then raise exception 'Daily closing submission permission required';end if;
 end if;
 if jsonb_array_length(employee_ids)>0 and not phonefix_private.can('attendance_edit') then raise exception 'Attendance edit permission required to mark employees';end if;
 if payload->>'kind' is distinct from 'sale' or jsonb_typeof(employee_ids) is distinct from 'array' then raise exception 'Invalid daily sales request';end if;
 if jsonb_array_length(employee_ids)>200 then raise exception 'Too many employees';end if;
 if jsonb_array_length(employee_ids)>0 and day_value>(now() at time zone 'America/New_York')::date then raise exception 'Attendance cannot be recorded for a future date';end if;
 sale:=public.pf_operation_save(payload);
 for uid in select distinct value::uuid from jsonb_array_elements_text(employee_ids) order by value::uuid loop
  if not exists(select 1 from public.pf_members m where m.user_id=uid and m.store_id='philadelphia' and m.revoked_at is null) then raise exception 'Select an active store employee';end if;
  perform pg_advisory_xact_lock(hashtextextended('daily-attendance:'||day_value::text||':'||uid::text,0));
  select * into existing from public.pf_operations r where r.kind='attendance' and r.store_id='philadelphia' and r.day=day_value and r.user_id=uid and not r.archived;
  if existing.id is null then attendance:=attendance||jsonb_build_array(public.pf_operation_save(jsonb_build_object('id',gen_random_uuid(),'kind','attendance','day',day_value,'user_id',uid,'expected_version',0,'data',jsonb_build_object('status','present','description','Recorded with daily sales','reason',''))));
  else attendance:=attendance||jsonb_build_array(to_jsonb(existing));end if;
 end loop;
 return jsonb_build_object('sale',sale,'attendance',attendance);
end $$;

revoke all on function public.pf_operations_list(),public.pf_operation_save(jsonb),public.pf_operation_history(uuid),public.pf_daily_sale_save(jsonb,jsonb) from public,anon;
grant execute on function public.pf_operations_list(),public.pf_operation_save(jsonb),public.pf_operation_history(uuid),public.pf_daily_sale_save(jsonb,jsonb) to authenticated;
