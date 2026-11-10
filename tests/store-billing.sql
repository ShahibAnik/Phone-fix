begin;
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-4000-8000-000000000081','trade-manager@example.invalid',now()),('00000000-0000-4000-8000-000000000082','trade-employee@example.invalid',now());
insert into public.pf_members(user_id,email,role,team_role) values ('00000000-0000-4000-8000-000000000081','trade-manager@example.invalid','manager','manager'),('00000000-0000-4000-8000-000000000082','trade-employee@example.invalid','employee','employee');
insert into public.pf_records(store_id,kind,record_id,data,client_version,modified_by) values('philadelphia','parts','TRADE-TEST-ONLY','{"sku":"TRADE-TEST-ONLY","model":"Fixture","qty":5,"cost":10}',1,'00000000-0000-4000-8000-000000000081');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000081","session_id":"trade-fixture"}',true);
do $$declare p jsonb:='{"id":"00000000-0000-4000-8000-000000000083","kind":"sale","day":"2026-01-01","account_kind":"store","account_name":"Fixture Store","source_kind":"parts","source_id":"TRADE-TEST-ONLY","stock_version":1,"quantity":2,"unit_price":2000,"paid":500,"method":"Cash"}';r jsonb;l jsonb;begin
 r:=public.pf_trade_save(p);
 if (r->'stock_after'->>'qty')::int<>3 or (r->>'amount')::int<>4000 then raise exception 'Bad stock or amount';end if;
 r:=public.pf_trade_save(p);if not (r->>'replayed')::boolean then raise exception 'Replay missing';end if;
 l:=public.pf_trade_list();if (select count(*) from jsonb_array_elements(l->'entries') e where e->>'account_id'=r->>'account_id')<>2 then raise exception 'Duplicate save';end if;
 begin perform public.pf_trade_save(p||'{"id":"00000000-0000-4000-8000-000000000084"}'::jsonb);raise exception 'Accepted stale stock';exception when raise_exception then if sqlerrm<>'Stock changed. Refresh and reopen this sale' then raise;end if;end;
 begin perform public.pf_master_backup();raise exception 'Manager backup allowed';exception when raise_exception then if sqlerrm<>'Developer access required' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000082',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000082","session_id":"trade-employee"}',true);
do $$begin
 begin perform public.pf_trade_list();raise exception 'Employee billing exposed';exception when raise_exception then if sqlerrm<>'Manager access required' then raise;end if;end;
 begin perform public.pf_master_backup();raise exception 'Employee backup exposed';exception when raise_exception then if sqlerrm<>'Developer access required' then raise;end if;end;
end $$;
reset role;
do $$begin
 if (select (data->>'qty')::int from public.pf_records where kind='parts' and record_id='TRADE-TEST-ONLY')<>3 then raise exception 'Stock deducted twice';end if;
 update public.pf_members set team_role='developer' where user_id='00000000-0000-4000-8000-000000000081';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000081","session_id":"trade-fixture"}',true);
do $$declare b jsonb;begin b:=public.pf_master_backup();if not b ? 'pf_trade_entries' or not b ? 'pf_records' then raise exception 'Incomplete backup';end if;end $$;
rollback;
