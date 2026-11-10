begin;
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-4000-8000-000000000091','ops-manager@example.invalid',now()),('00000000-0000-4000-8000-000000000092','ops-employee@example.invalid',now());
insert into public.pf_members(user_id,email,role,team_role,permissions) values ('00000000-0000-4000-8000-000000000091','ops-manager@example.invalid','manager','manager',null),('00000000-0000-4000-8000-000000000092','ops-employee@example.invalid','employee','employee',array['intake_create']);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000091","session_id":"ops-fixture"}',true);
do $$declare p jsonb:='{"id":"00000000-0000-4000-8000-000000000098","kind":"sale","day":"2026-02-01","expected_version":0,"data":{"cash":100,"card":0,"other":0,"description":"Fixture","reason":""}}';r jsonb;again jsonb;begin
 r:=public.pf_daily_sale_save(p,'["00000000-0000-4000-8000-000000000092","00000000-0000-4000-8000-000000000092"]');
 if jsonb_array_length(r->'attendance')<>1 or r->'attendance'->0->'data'->>'status'<>'present' then raise exception 'Missing or duplicate attendance';end if;
 again:=public.pf_daily_sale_save(p,'["00000000-0000-4000-8000-000000000092"]');
 if again->'attendance'->0->>'id'<>r->'attendance'->0->>'id' then raise exception 'Retry duplicated attendance';end if;
 perform public.pf_operation_save(jsonb_build_object('id',r->'attendance'->0->>'id','kind','attendance','day','2026-02-01','user_id','00000000-0000-4000-8000-000000000092','expected_version',1,'data',jsonb_build_object('status','half','description','Correction','reason','Half day')));
 again:=public.pf_daily_sale_save(p,'["00000000-0000-4000-8000-000000000092"]');
 if again->'attendance'->0->'data'->>'status'<>'half' then raise exception 'Manager correction overwritten';end if;
 begin perform public.pf_daily_sale_save(p||'{"id":"00000000-0000-4000-8000-000000000099","day":"2026-02-02"}'::jsonb,'["00000000-0000-4000-8000-000000000001"]');raise exception 'Invalid employee accepted';exception when raise_exception then if sqlerrm<>'Select an active store employee' then raise;end if;end;
 if exists(select 1 from jsonb_array_elements(public.pf_operations_list()->'records') v where v->>'id'='00000000-0000-4000-8000-000000000099') then raise exception 'Sale not rolled back';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000092","session_id":"ops-employee"}',true);
do $$begin
 begin perform public.pf_daily_sale_save('{"kind":"sale"}','[]');raise exception 'Employee wrote sales';exception when raise_exception then if sqlerrm<>'Manager access required' then raise;end if;end;
end $$;
reset role;
select 'Sales and attendance atomic save, retry, preserved corrections, and manager-only access passed' as result;
rollback;
