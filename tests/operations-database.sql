begin;
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-4000-8000-000000000091','ops-manager@example.invalid',now()),('00000000-0000-4000-8000-000000000092','ops-employee@example.invalid',now());
insert into public.pf_members(user_id,email,role,team_role,permissions) values ('00000000-0000-4000-8000-000000000091','ops-manager@example.invalid','manager','manager',null),('00000000-0000-4000-8000-000000000092','ops-employee@example.invalid','employee','employee',array['intake_create']);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000091","session_id":"ops-fixture"}',true);
select public.pf_operation_save('{"id":"00000000-0000-4000-8000-000000000093","kind":"sale","day":"2026-01-01","expected_version":0,"data":{"cash":10000,"card":5000,"other":0,"description":"Fixture","reason":""}}');
select public.pf_operation_save('{"id":"00000000-0000-4000-8000-000000000094","kind":"attendance","day":"2026-01-01","user_id":"00000000-0000-4000-8000-000000000092","expected_version":0,"data":{"status":"present","description":"Fixture","reason":""}}');
select public.pf_operation_save('{"id":"00000000-0000-4000-8000-000000000095","kind":"rate","day":"2026-01-01","user_id":"00000000-0000-4000-8000-000000000091","expected_version":0,"data":{"amount":20000,"description":"Fixture","reason":""}}');
do $$begin
 begin perform public.pf_operation_save('{"id":"00000000-0000-4000-8000-000000000093","kind":"sale","day":"2026-01-01","expected_version":0,"data":{"cash":20000,"card":0,"other":0,"reason":"Correction"}}');raise exception 'Stale version accepted';exception when raise_exception then if sqlerrm<>'This record changed. Refresh and reopen it before saving' then raise;end if;end;
 begin perform public.pf_operation_save('{"id":"00000000-0000-4000-8000-000000000096","kind":"sale","day":"2026-01-01","expected_version":0,"data":{"cash":1,"card":0,"other":0}}');raise exception 'Duplicate day accepted';exception when unique_violation then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000092","session_id":"ops-employee"}',true);
do $$declare result jsonb;begin
 result:=public.pf_operations_list();
 if exists(select 1 from jsonb_array_elements(result->'records') r where r->>'kind'='sale' or (r->>'kind'<>'note' and r->>'user_id'<>'00000000-0000-4000-8000-000000000092')) then raise exception 'Employee saw restricted data';end if;
 if not exists(select 1 from jsonb_array_elements(result->'records') r where r->>'id'='00000000-0000-4000-8000-000000000094') then raise exception 'Own attendance missing';end if;
 begin perform public.pf_operation_save('{"id":"00000000-0000-4000-8000-000000000094","kind":"attendance","day":"2026-01-01","user_id":"00000000-0000-4000-8000-000000000092","expected_version":1,"data":{"status":"half","reason":"Try edit"}}');raise exception 'Employee edited attendance';exception when raise_exception then if sqlerrm<>'Manager access required' then raise;end if;end;
 begin perform public.pf_operation_history('00000000-0000-4000-8000-000000000095');raise exception 'Employee saw manager pay audit';exception when raise_exception then if sqlerrm<>'Access denied' then raise;end if;end;
 begin perform count(*) from public.pf_operations;raise exception 'Direct access allowed';exception when insufficient_privilege then null;end;
 perform public.pf_operation_save('{"id":"00000000-0000-4000-8000-000000000097","kind":"note","day":"2026-01-01","expected_version":0,"data":{"customer_id":"TEST","name":"Fixture","phone":"2155550100","ticket_id":"","description":"Customer called","rating":4,"resolved":false,"reason":""}}');
 perform public.pf_operation_save('{"id":"00000000-0000-4000-8000-000000000097","kind":"note","day":"2026-01-01","expected_version":1,"data":{"customer_id":"TEST","name":"Fixture","phone":"2155550100","ticket_id":"","description":"Customer called","rating":4,"resolved":true,"reason":"Resolved"}}');
 begin perform public.pf_operation_save('{"id":"00000000-0000-4000-8000-000000000097","kind":"note","day":"2026-01-01","expected_version":2,"data":{"customer_id":"TEST","name":"Fixture","phone":"2155550100","ticket_id":"","description":"Changed text","rating":4,"resolved":true,"reason":"Correction"}}');raise exception 'Employee rewrote note';exception when raise_exception then if sqlerrm<>'Employees may only resolve or reopen existing notes' then raise;end if;end;
end $$;
set local role anon;
do $$begin
 begin perform public.pf_operations_list();raise exception 'Anonymous access allowed';exception when insufficient_privilege then null;end;
 begin perform public.pf_operations_sheet_pull('bad-token');raise exception 'Invalid token allowed';exception when raise_exception then if sqlerrm<>'Invalid connector token' then raise;end if;end;
end $$;
reset role;
select 'All operations permission, version and uniqueness checks passed; fixtures rolled back' as result;
rollback;
