create or replace function public.pf_operations_sheet_ack(token text,records jsonb) returns void language plpgsql security definer set search_path='' as $$
declare x jsonb;
begin
 if not exists(select 1 from phonefix_private.operations_sheet_connector c where c.token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'Invalid connector token';end if;
 if jsonb_array_length(records)>200 then raise exception 'Batch too large';end if;
 for x in select * from jsonb_array_elements(records) loop
  update public.pf_operations set synced_version=greatest(synced_version,least(version,(x->>'version')::bigint)),sync_error=nullif(left(x->>'error',500),'') where id=(x->>'id')::uuid and (x->>'version')::bigint>=0;
 end loop;
 update phonefix_private.operations_sheet_connector set last_sync_at=now() where singleton=true;
end $$;
