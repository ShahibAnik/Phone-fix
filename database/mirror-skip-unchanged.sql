-- Mirror skips unchanged records (D021). NOT YET APPLIED — apply only with owner approval.
-- Every device re-sends records it pulled from the sheet, so the same repair was rewritten
-- ~50 times with identical data and only a new client_version. Skip those writes entirely.
begin;
create or replace function phonefix_private.mirror(events jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare e jsonb; n integer:=0; old_version bigint; old_data jsonb; old_deleted boolean; k text; rid text;
begin
 if auth.uid() is null or phonefix_private.store_role('philadelphia') is null then raise exception 'Store membership required';end if;
 if jsonb_typeof(events)<>'array' or jsonb_array_length(events)>100 then raise exception 'Invalid batch';end if;
 for e in select value from jsonb_array_elements(events) loop
  if octet_length(e::text)>1048576 then raise exception 'Record too large';end if;
  k:=e->>'kind';rid:=e->>'id';
  if not phonefix_private.record_permission(k) then raise exception 'You don''t have permission for this.';end if;
  perform pg_advisory_xact_lock(hashtextextended('pf-mirror:'||k||':'||rid,0));
  select client_version,data,deleted into old_version,old_data,old_deleted from public.pf_records where store_id='philadelphia' and kind=k and record_id=rid;
  if old_version is not null and (e->>'version')::bigint<old_version then n:=n+1;continue;end if;
  -- New: same data and same deleted flag means nothing to write.
  if old_version is not null and old_data=coalesce(e->'data','{}') and old_deleted=coalesce((e->>'deleted')::boolean,false) then n:=n+1;continue;end if;
  if old_version is not null then
   update public.pf_records set data=coalesce(e->'data','{}'),deleted=coalesce((e->>'deleted')::boolean,false),client_version=(e->>'version')::bigint,modified_by=auth.uid(),updated_at=now()
   where store_id='philadelphia' and kind=k and record_id=rid;
  else
   insert into public.pf_records(store_id,kind,record_id,data,deleted,client_version,modified_by)
   values('philadelphia',k,rid,coalesce(e->'data','{}'),coalesce((e->>'deleted')::boolean,false),(e->>'version')::bigint,auth.uid());
  end if;
  n:=n+1;
 end loop;return n;
end $$;
commit;
