-- Shared learned suggestions and developer-controlled workspace customization.
-- Existing repair records are read only; this migration does not rewrite history.

alter table public.pf_settings add column if not exists sidebar_order jsonb not null default '[]'::jsonb;

create table if not exists public.pf_suggestion_visibility (
  store_id text not null,
  kind text not null check (kind in ('technician','model')),
  normalized_value text not null,
  display_value text not null,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (store_id,kind,normalized_value)
);
alter table public.pf_suggestion_visibility enable row level security;
revoke all on public.pf_suggestion_visibility from public, anon, authenticated;

create or replace function public.pf_workspace_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sid text;
  result jsonb;
begin
  select m.store_id into sid
  from public.pf_members m
  where m.user_id=auth.uid() and m.revoked_at is null;
  if sid is null then raise exception 'Access denied'; end if;

  with repair_values as (
    select 'technician'::text kind,
      lower(regexp_replace(btrim(r.data->>'fixedBy'),'\s+',' ','g')) normalized_value,
      regexp_replace(btrim(r.data->>'fixedBy'),'\s+',' ','g') display_value
    from public.pf_records r where r.store_id=sid and r.kind='repairs' and not r.deleted and nullif(btrim(r.data->>'fixedBy'),'') is not null and btrim(r.data->>'fixedBy')<>'—'
    union all
    select 'model',lower(regexp_replace(btrim(r.data->>'device'),'\s+',' ','g')),regexp_replace(btrim(r.data->>'device'),'\s+',' ','g')
    from public.pf_records r where r.store_id=sid and r.kind='repairs' and not r.deleted and nullif(btrim(r.data->>'device'),'') is not null
  ), counts as (
    select kind,normalized_value,min(display_value) display_value,count(*)::int use_count from repair_values group by kind,normalized_value
  ), combined as (
    select coalesce(c.kind,v.kind) kind,coalesce(c.normalized_value,v.normalized_value) normalized_value,
      coalesce(c.display_value,v.display_value) display_value,coalesce(c.use_count,0) use_count,coalesce(v.hidden,false) hidden
    from counts c full join public.pf_suggestion_visibility v
      on v.store_id=sid and v.kind=c.kind and v.normalized_value=c.normalized_value
    where v.store_id is null or v.store_id=sid
  )
  select jsonb_build_object(
    'technicians',coalesce((select jsonb_agg(jsonb_build_object('value',display_value,'count',use_count,'hidden',hidden) order by use_count desc,display_value) from combined where kind='technician'),'[]'::jsonb),
    'models',coalesce((select jsonb_agg(jsonb_build_object('value',display_value,'count',use_count,'hidden',hidden) order by use_count desc,display_value) from combined where kind='model'),'[]'::jsonb),
    'sidebarOrder',coalesce((select s.sidebar_order from public.pf_settings s where s.store_id=sid),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.pf_developer_customization_save(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid text; actor_email text; action_name text:=payload->>'action'; before_value jsonb; allowed text[]:=array['intake','history','queue','inventory','credit','days','payroll','notes','trade','backup','daily','overview','records','audit','sales','team','automation'];
begin
  select m.store_id,m.email into sid,actor_email from public.pf_members m
  where m.user_id=auth.uid() and m.revoked_at is null and m.team_role='developer';
  if sid is null then raise exception 'Developer access required'; end if;

  if action_name='visibility' then
    if payload->>'kind' not in ('technician','model') or nullif(btrim(payload->>'value'),'') is null then raise exception 'Invalid suggestion'; end if;
    select to_jsonb(v) into before_value from public.pf_suggestion_visibility v where v.store_id=sid and v.kind=payload->>'kind' and v.normalized_value=lower(regexp_replace(btrim(payload->>'value'),'\s+',' ','g'));
    insert into public.pf_suggestion_visibility(store_id,kind,normalized_value,display_value,hidden,updated_by)
    values(sid,payload->>'kind',lower(regexp_replace(btrim(payload->>'value'),'\s+',' ','g')),regexp_replace(btrim(payload->>'value'),'\s+',' ','g'),coalesce((payload->>'hidden')::boolean,false),auth.uid())
    on conflict(store_id,kind,normalized_value) do update set display_value=excluded.display_value,hidden=excluded.hidden,updated_at=now(),updated_by=auth.uid();
    insert into public.pf_audit(store_id,entity,record_id,action,actor_id,actor_email,before_data,after_data)
    values(sid,'suggestion',payload->>'kind'||':'||lower(regexp_replace(btrim(payload->>'value'),'\s+',' ','g')),'visibility_changed',auth.uid(),actor_email,before_value,payload);
  elsif action_name='sidebar' then
    if jsonb_typeof(payload->'order')<>'array' or exists(select 1 from jsonb_array_elements_text(payload->'order') x where not (x=any(allowed))) or jsonb_array_length(payload->'order')<>(select count(distinct x) from jsonb_array_elements_text(payload->'order') x) then raise exception 'Invalid sidebar order'; end if;
    select sidebar_order into before_value from public.pf_settings where store_id=sid;
    insert into public.pf_settings(store_id,sidebar_order) values(sid,payload->'order') on conflict(store_id) do update set sidebar_order=excluded.sidebar_order,updated_at=now();
    insert into public.pf_audit(store_id,entity,record_id,action,actor_id,actor_email,before_data,after_data)
    values(sid,'settings','sidebar_order','sidebar_order_changed',auth.uid(),actor_email,jsonb_build_object('order',before_value),jsonb_build_object('order',payload->'order'));
  else raise exception 'Invalid customization action';
  end if;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.pf_workspace_config() from public,anon;
revoke all on function public.pf_developer_customization_save(jsonb) from public,anon;
grant execute on function public.pf_workspace_config() to authenticated;
grant execute on function public.pf_developer_customization_save(jsonb) to authenticated;
