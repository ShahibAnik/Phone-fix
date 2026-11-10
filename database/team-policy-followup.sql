-- Align existing settings and audit policies with the approved team permission model.
begin;
drop policy settings_update on public.pf_settings;
create policy settings_update on public.pf_settings for update to authenticated
 using (store_id='philadelphia' and phonefix_private.can('settings_manage'))
 with check (store_id='philadelphia' and phonefix_private.can('settings_manage'));
drop policy audit_manager_read on public.pf_audit;
create policy audit_manager_read on public.pf_audit for select to authenticated
 using (store_id='philadelphia' and phonefix_private.can('history_edit') and phonefix_private.can('costs_view'));
commit;
