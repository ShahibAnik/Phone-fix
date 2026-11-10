-- Run after staged DDL in a transaction that ends with ROLLBACK.
insert into auth.users(id,email,email_confirmed_at) values
('00000000-0000-4000-8000-000000000081','team-fixture-manager@example.invalid',now()),
('00000000-0000-4000-8000-000000000082','team-fixture-employee@example.invalid',now()),
('00000000-0000-4000-8000-000000000083','team-fixture-owner@example.invalid',now());
insert into public.pf_members(user_id,email,role,team_role,permissions) values
('00000000-0000-4000-8000-000000000081','team-fixture-manager@example.invalid','manager','manager',null),
('00000000-0000-4000-8000-000000000082','team-fixture-employee@example.invalid','employee','employee',array['intake_create']),
('00000000-0000-4000-8000-000000000083','team-fixture-owner@example.invalid','manager','owner',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000081","session_id":"fixture-manager"}',true);
do $$ begin
 begin perform public.pf_team_save('{"email":"anikshahib@gmail.com","role":"employee","name":"X","active":false}');raise exception 'Developer was edited';exception when raise_exception then if sqlerrm<>'The Developer account is permanent and cannot be edited' then raise;end if;end;
 begin perform public.pf_team_save('{"email":"team-fixture-owner@example.invalid","role":"employee","name":"X"}');raise exception 'Owner was edited';exception when raise_exception then if sqlerrm<>'Managers can manage employees only' then raise;end if;end;
 begin perform public.pf_team_save('{"email":"team-fixture-employee@example.invalid","role":"employee","name":"X","permissions":["team_manage"]}');raise exception 'Employee granted team management';exception when raise_exception then if sqlerrm<>'Employees cannot receive team management permission' then raise;end if;end;
 perform public.pf_team_save('{"email":"team-fixture-employee@example.invalid","role":"employee","name":"Fixture","permissions":["intake_create"]}');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000082',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000082","session_id":"fixture-one"}',true);
do $$ declare r jsonb;begin
 if not phonefix_private.can('intake_create') or phonefix_private.can('history_edit') or phonefix_private.can('team_manage') then raise exception 'Permission defaults failed';end if;
 r:=public.pf_pin_action(jsonb_build_object('action','setup','newHash',repeat('a',64),'newRecoveryHash',repeat('b',64)));
 if not (r->>'ok')::boolean then raise exception 'PIN setup failed';end if;
 for i in 1..5 loop r:=public.pf_pin_action(jsonb_build_object('action','unlock','currentHash',repeat('c',64)));if (r->>'ok')::boolean then raise exception 'Wrong PIN accepted';end if;end loop;
 r:=public.pf_pin_action(jsonb_build_object('action','unlock','currentHash',repeat('a',64)));
 if r->>'blockedUntil' is null then raise exception 'Lockout did not persist';end if;
end $$;
reset role;
update phonefix_private.pin_credentials set blocked_until=now()-interval '1 second' where user_id='00000000-0000-4000-8000-000000000082';
set local role authenticated;
do $$ declare r jsonb;begin
 r:=public.pf_pin_action(jsonb_build_object('action','recover','recoveryHash',repeat('b',64),'newHash',repeat('d',64)));
 if not (r->>'ok')::boolean then raise exception 'Recovery failed';end if;
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000082","session_id":"fixture-two"}',true);
 perform public.pf_pin_action(jsonb_build_object('action','unlock','currentHash',repeat('d',64)));
 perform public.pf_pin_action(jsonb_build_object('action','change','currentHash',repeat('d',64),'newHash',repeat('e',64)));
 if not (public.pf_access_context()->>'unlocked')::boolean then raise exception 'Current session lost after PIN change';end if;
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000082","session_id":"fixture-one"}',true);
 if (public.pf_access_context()->>'unlocked')::boolean then raise exception 'Other session still unlocked';end if;
end $$;
-- Manager deactivates a fixture; membership is refused and business rows survive.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000081","session_id":"fixture-manager"}',true);
insert into public.pf_records(store_id,kind,record_id,data,client_version,modified_by) values
('philadelphia','repairs','TEAM-TEST-FIXTURE','{"id":"TEAM-TEST-FIXTURE","name":"Test","isPaid":false}',1,'00000000-0000-4000-8000-000000000081');
select public.pf_team_save('{"email":"team-fixture-employee@example.invalid","role":"employee","name":"Fixture","active":false,"permissions":["intake_create"]}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000082',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000082","session_id":"fixture-two"}',true);
do $$ begin
 if exists(select 1 from public.pf_claim_membership()) then raise exception 'Revoked member returned';end if;
 if phonefix_private.can('intake_create') then raise exception 'Revoked member retained permission';end if;
 begin perform public.pf_access_context();raise exception 'Revoked access accepted';exception when raise_exception then if sqlerrm<>'Your store access is not active' then raise;end if;end;
end $$;
reset role;
do $$ begin
 if not exists(select 1 from public.pf_records where record_id='TEAM-TEST-FIXTURE' and not deleted) then raise exception 'Deactivation changed business row';end if;
end $$;
select 'PASS: protected roles, permission defaults, PIN lockout/recovery/change, other-device invalidation, deactivation preserves business records' as test_result;
rollback;
