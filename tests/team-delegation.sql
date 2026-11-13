begin;
insert into auth.users(id,email,email_confirmed_at) values
('00000000-0000-4000-8000-000000000091','delegate-manager@example.invalid',now()),
('00000000-0000-4000-8000-000000000092','delegate-employee@example.invalid',now()),
('00000000-0000-4000-8000-000000000093','delegate-owner@example.invalid',now()),
('00000000-0000-4000-8000-000000000094','delegate-developer@example.invalid',now());
insert into public.pf_members(user_id,email,role,team_role,permissions) values
('00000000-0000-4000-8000-000000000091','delegate-manager@example.invalid','manager','manager',array['team_manage','repair_create']),
('00000000-0000-4000-8000-000000000092','delegate-employee@example.invalid','employee','employee',array['inventory_view']),
('00000000-0000-4000-8000-000000000093','delegate-owner@example.invalid','manager','owner',null),
('00000000-0000-4000-8000-000000000094','delegate-developer@example.invalid','manager','developer',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
do $$ begin
 perform public.pf_team_save('{"email":"delegate-employee@example.invalid","name":"Fixture","role":"employee","permissions":["repair_create","inventory_view","attendance_own"]}');
 begin
 perform public.pf_team_save('{"email":"delegate-employee@example.invalid","name":"Fixture","role":"employee","permissions":["repair_create","inventory_view","inventory_edit"]}');
 raise exception 'FAIL unauthorized grant accepted';
 exception when raise_exception then if sqlerrm<>'Managers can change only permissions they already have' then raise;end if;end;
 begin
 perform public.pf_team_save('{"email":"delegate-employee@example.invalid","name":"Fixture","role":"employee","permissions":["repair_create"]}');
 raise exception 'FAIL unauthorized removal accepted';
 exception when raise_exception then if sqlerrm<>'Managers can change only permissions they already have' then raise;end if;end;
 begin
 perform public.pf_team_save('{"email":"delegate-owner@example.invalid","name":"Fixture","role":"employee","permissions":[]}');
 raise exception 'FAIL owner edited';
 exception when raise_exception then if sqlerrm<>'Managers can manage employees only' then raise;end if;end;
 begin
 perform public.pf_team_save('{"email":"delegate-employee@example.invalid","name":"Fixture","role":"manager","permissions":null}');
 raise exception 'FAIL promotion';
 exception when raise_exception then if sqlerrm<>'Managers can manage employees only' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000093',true);
select public.pf_team_save('{"email":"delegate-employee@example.invalid","name":"Fixture","role":"employee","permissions":["inventory_edit"]}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000094',true);
select public.pf_team_save('{"email":"delegate-employee@example.invalid","name":"Fixture","role":"employee","permissions":["repair_view"]}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
do $$ begin
 begin
 perform public.pf_team_save('{"email":"new-fixture@example.invalid","name":"Fixture","role":"employee","permissions":[]}');
 raise exception 'FAIL employee changed access';
 exception when raise_exception then if sqlerrm<>'You don''t have permission for this.' then raise;end if;end;
end $$;
reset role;
select 'PASS: Owner and Developer save; manager can delegate owned permissions, cannot grant/remove others or promote; employee denied' as result;
rollback;
