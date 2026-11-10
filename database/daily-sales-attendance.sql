-- Save sales and new attendance together: failure rolls back both.
create or replace function public.pf_daily_sale_save(payload jsonb,employee_ids jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor jsonb:=phonefix_private.operations_actor();sale jsonb;attendance jsonb:='[]'::jsonb;uid uuid;existing public.pf_operations;day_value date:=(payload->>'day')::date;
begin
 if actor->>'role' not in ('developer','owner','manager') then raise exception 'Manager access required';end if;
 if payload->>'kind' is distinct from 'sale' or jsonb_typeof(employee_ids) is distinct from 'array' then raise exception 'Invalid daily sales request';end if;
 if jsonb_array_length(employee_ids)>200 then raise exception 'Too many employees';end if;
 if jsonb_array_length(employee_ids)>0 and day_value>(now() at time zone 'America/New_York')::date then raise exception 'Attendance cannot be recorded for a future date';end if;
 sale:=public.pf_operation_save(payload);
 for uid in select distinct value::uuid from jsonb_array_elements_text(employee_ids) order by value::uuid loop
  if not exists(select 1 from public.pf_members m where m.user_id=uid and m.store_id='philadelphia' and m.revoked_at is null) then raise exception 'Select an active store employee';end if;
  perform pg_advisory_xact_lock(hashtextextended('daily-attendance:'||day_value::text||':'||uid::text,0));
  select * into existing from public.pf_operations r where r.kind='attendance' and r.store_id='philadelphia' and r.day=day_value and r.user_id=uid and not r.archived;
  if existing.id is null then
   attendance:=attendance||jsonb_build_array(public.pf_operation_save(jsonb_build_object('id',gen_random_uuid(),'kind','attendance','day',day_value,'user_id',uid,'expected_version',0,'data',jsonb_build_object('status','present','description','Recorded with daily sales','reason',''))));
  else attendance:=attendance||jsonb_build_array(to_jsonb(existing));end if;
 end loop;
 return jsonb_build_object('sale',sale,'attendance',attendance);
end $$;
revoke all on function public.pf_daily_sale_save(jsonb,jsonb) from public,anon;
grant execute on function public.pf_daily_sale_save(jsonb,jsonb) to authenticated;
