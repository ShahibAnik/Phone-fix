begin;
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-4000-8000-000000000081','trade-manager@example.invalid',now()),('00000000-0000-4000-8000-000000000082','trade-employee@example.invalid',now());
insert into public.pf_members(user_id,email,role,team_role) values ('00000000-0000-4000-8000-000000000081','trade-manager@example.invalid','manager','manager'),('00000000-0000-4000-8000-000000000082','trade-employee@example.invalid','employee','employee');
insert into public.pf_records(store_id,kind,record_id,data,client_version,modified_by) values('philadelphia','parts','TRADE-TEST-ONLY','{"sku":"TRADE-TEST-ONLY","model":"Fixture","qty":5,"cost":10}',1,'00000000-0000-4000-8000-000000000081');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000081","session_id":"trade-fixture"}',true);
do $$declare p jsonb:='{"id":"00000000-0000-4000-8000-000000000083","kind":"sale","day":"2026-01-01","account_kind":"employee","account_name":"Other Branch Worker","employee_location":"Downtown","employee_id":null,"source_kind":"parts","source_id":"TRADE-TEST-ONLY","stock_version":1,"quantity":2,"unit_price":2000,"paid":500,"method":"Cash"}';r jsonb;l jsonb;aid text;begin
 r:=public.pf_trade_save(p);aid:=r->>'account_id';
 r:=public.pf_trade_save(jsonb_build_object('id','00000000-0000-4000-8000-000000000084','kind','payment','day','2026-01-01','account_kind','employee','account_name','other branch worker','employee_location','downtown','amount',100,'method','Cash'));
 if r->>'account_id'<>aid then raise exception 'Custom employee not reused';end if;
 perform public.pf_trade_delete('00000000-0000-4000-8000-000000000083','Entered twice');
 perform public.pf_trade_delete('00000000-0000-4000-8000-000000000083','Retry request');
 l:=public.pf_trade_list();
 if (select count(*) from jsonb_array_elements(l->'entries') e where e->>'account_id'=aid and e->>'deleted_at' is not null)<>2 then raise exception 'Sale and initial payment must be deleted together';end if;
 if (select count(*) from jsonb_array_elements(l->'entries') e where e->>'account_id'=aid and e->>'deleted_at' is null)<>1 then raise exception 'Separate payment unexpectedly deleted';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000082',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000082","session_id":"trade-employee"}',true);
do $$begin
 begin perform public.pf_trade_delete('00000000-0000-4000-8000-000000000084','Unauthorized');raise exception 'Employee deletion allowed';exception when raise_exception then if sqlerrm<>'Manager access required' then raise;end if;end;
end $$;
reset role;
do $$begin
 if (select (data->>'qty')::int from public.pf_records where kind='parts' and record_id='TRADE-TEST-ONLY')<>3 then raise exception 'Delete changed inventory';end if;
 if (select count(*) from public.pf_trade_entries where account_id in (select id from public.pf_trade_accounts where name='Other Branch Worker') and deletion_id is not null)<>2 then raise exception 'Missing sheet deletion audit';end if;
end $$;
rollback;
