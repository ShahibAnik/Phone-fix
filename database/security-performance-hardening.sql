-- Remove an unused privileged RPC surface and improve RLS/audit query plans.

revoke all on function public.rls_auto_enable() from public,anon,authenticated;

create index if not exists pf_operations_audit_record_id_idx on public.pf_operations_audit(record_id);

drop policy if exists records_insert on public.pf_records;
create policy records_insert on public.pf_records for insert to authenticated
with check(store_id='philadelphia' and modified_by=(select auth.uid()) and phonefix_private.record_permission(kind));

drop policy if exists records_update on public.pf_records;
create policy records_update on public.pf_records for update to authenticated
using(store_id='philadelphia' and phonefix_private.record_permission(kind))
with check(store_id='philadelphia' and modified_by=(select auth.uid()) and phonefix_private.record_permission(kind));
