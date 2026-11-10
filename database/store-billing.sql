begin;
create table public.pf_trade_accounts(id uuid primary key default gen_random_uuid(),store_id text not null default 'philadelphia' check(store_id='philadelphia'),kind text not null check(kind in ('store','employee')),name text not null check(length(trim(name)) between 1 and 160),employee_id uuid references auth.users(id),created_at timestamptz not null default now(),created_by text not null);
create unique index pf_trade_account_name on public.pf_trade_accounts(lower(trim(name))) where kind='store';
create unique index pf_trade_account_employee on public.pf_trade_accounts(employee_id) where kind='employee';
create table public.pf_trade_entries(id uuid primary key,account_id uuid not null references public.pf_trade_accounts(id),kind text not null check(kind in ('sale','payment')),day date not null,item text,quantity integer,unit_cost bigint,unit_price bigint,amount bigint not null check(amount>=0),method text,description text not null default '',source_kind text,source_id text,stock_before jsonb,stock_after jsonb,request jsonb not null,created_at timestamptz not null default now(),created_by text not null,synced boolean not null default false,sync_error text);
alter table public.pf_trade_accounts enable row level security;
alter table public.pf_trade_entries enable row level security;
revoke all on public.pf_trade_accounts,public.pf_trade_entries from public,anon,authenticated;
create function public.pf_trade_list() returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();begin
 if a->>'role' not in ('developer','owner','manager') then raise exception 'Manager access required';end if;
 return jsonb_build_object('accounts',coalesce((select jsonb_agg(to_jsonb(r) order by name) from public.pf_trade_accounts r),'[]'::jsonb),'entries',coalesce((select jsonb_agg(to_jsonb(r)-'request' order by day,created_at,id) from public.pf_trade_entries r),'[]'::jsonb),'inventory',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',record_id,'data',data,'version',client_version)) from public.pf_records where store_id='philadelphia' and kind in ('inventory','parts','accessories') and not deleted),'[]'::jsonb),'members',coalesce((select jsonb_agg(jsonb_build_object('id',user_id,'name',coalesce(nullif(display_name,''),email))) from public.pf_members where store_id='philadelphia' and revoked_at is null),'[]'::jsonb));end $$;
create function public.pf_trade_save(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();rid uuid:=(payload->>'id')::uuid;aid uuid;atype text:=payload->>'account_kind';nm text:=trim(payload->>'account_name');uid uuid:=(payload->>'employee_id')::uuid;k text:=payload->>'kind';d date:=(payload->>'day')::date;q integer;cost bigint;price bigint;amt bigint;paid bigint:=coalesce((payload->>'paid')::bigint,0);r public.pf_trade_entries;stock public.pf_records;after_stock jsonb;sk text:=payload->>'source_kind';sid text:=payload->>'source_id';item_name text:=trim(payload->>'item');
begin
 if a->>'role' not in ('developer','owner','manager') then raise exception 'Manager access required';end if;
 if rid is null or d is null or d>(now() at time zone 'America/New_York')::date or k is null or k not in ('sale','payment') then raise exception 'Invalid transaction';end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));select * into r from public.pf_trade_entries where id=rid;
 if r.id is not null then if r.request<>payload then raise exception 'This request was already saved with different values';end if;return (to_jsonb(r)-'request')||jsonb_build_object('replayed',true);end if;
 if atype is null or atype not in ('store','employee') or nm is null or length(nm) not between 1 and 160 then raise exception 'Enter a store or employee name';end if;
 if atype='employee' and (uid is null or not exists(select 1 from public.pf_members where user_id=uid and store_id='philadelphia' and revoked_at is null)) then raise exception 'Select an active employee';end if;
 if length(coalesce(payload->>'description',''))>4000 then raise exception 'Notes are too long';end if;
 perform pg_advisory_xact_lock(hashtextextended('trade-account:'||atype||':'||case when atype='employee' then uid::text else lower(nm) end,0));
 select id into aid from public.pf_trade_accounts where kind=atype and (atype='store' and lower(trim(name))=lower(nm) or atype='employee' and employee_id=uid);
 if aid is null then insert into public.pf_trade_accounts(kind,name,employee_id,created_by) values(atype,nm,case when atype='employee' then uid end,a->>'email') returning id into aid;end if;
 if k='sale' then
  q:=(payload->>'quantity')::integer;price:=(payload->>'unit_price')::bigint;
  if q is null or q not between 1 and 100000 or price is null or price not between 0 and 100000000 then raise exception 'Enter valid quantity and selling price';end if;
  if sk is not null and sk<>'manual' then
   if sk not in ('inventory','parts','accessories') then raise exception 'Invalid inventory type';end if;
   perform pg_advisory_xact_lock(hashtextextended('pf-mirror:'||sk||':'||sid,0));
   select * into stock from public.pf_records where store_id='philadelphia' and kind=sk and record_id=sid and not deleted for update;
   if stock.record_id is null then raise exception 'Item is not backed up yet. Refresh inventory and retry';end if;
   if stock.client_version is distinct from (payload->>'stock_version')::bigint then raise exception 'Stock changed. Refresh and reopen this sale';end if;
   if sk='inventory' and coalesce(stock.data->>'status','') in ('Sold','On layaway') then raise exception 'This phone is sold or reserved';end if;
   if coalesce((stock.data->>'qty')::integer,0)<q then raise exception 'Not enough stock';end if;
   cost:=round(coalesce((stock.data->>case when sk='inventory' then 'price' else 'cost' end)::numeric,0)*100);item_name:=coalesce(stock.data->>'name',stock.data->>'model',sid);
   after_stock:=jsonb_set(stock.data,'{qty}',to_jsonb((stock.data->>'qty')::integer-q));
   if sk='inventory' and (after_stock->>'qty')::integer=0 then after_stock:=after_stock||jsonb_build_object('status','Sold','soldPrice',price*q/100.0,'soldDate',d,'custName',nm);end if;
   perform set_config('phonefix.trade_write','yes',true);
   update public.pf_records set data=after_stock,client_version=greatest(client_version+1,(extract(epoch from clock_timestamp())*1000)::bigint),updated_at=now(),modified_by=auth.uid() where store_id='philadelphia' and kind=sk and record_id=sid;
   perform set_config('phonefix.trade_write','no',true);
  else sk:='manual';cost:=(payload->>'unit_cost')::bigint;end if;
  if cost is null or cost not between 0 and 100000000 or item_name is null or length(item_name) not between 1 and 300 then raise exception 'Enter an item and buying price';end if;
  amt:=q*price;
  if paid<0 or paid>amt then raise exception 'Payment cannot exceed the sale total';end if;
 else amt:=(payload->>'amount')::bigint;if amt is null or amt not between 1 and 10000000000 then raise exception 'Enter a positive payment';end if;end if;
 if (k='payment' or paid>0) and coalesce(payload->>'method','') not in ('Cash','Card','Bank transfer','Other') then raise exception 'Select payment method';end if;
 insert into public.pf_trade_entries(id,account_id,kind,day,item,quantity,unit_cost,unit_price,amount,method,description,source_kind,source_id,stock_before,stock_after,request,created_by)
 values(rid,aid,k,d,item_name,q,cost,price,amt,payload->>'method',coalesce(payload->>'description',''),sk,sid,stock.data,after_stock,payload,a->>'email') returning * into r;
 if paid>0 and k='sale' then insert into public.pf_trade_entries(id,account_id,kind,day,amount,method,description,request,created_by) values(gen_random_uuid(),aid,'payment',d,paid,payload->>'method','Payment with sale '||rid,payload,a->>'email');end if;
 return to_jsonb(r)-'request';end $$;
-- Pending stock stays authoritative until the Inventory sheet acknowledges it.
create function phonefix_private.guard_pending_trade_stock() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.pf_trade_entries e where e.source_kind=old.kind and e.source_id=old.record_id and not e.synced) and (new.data->'qty' is distinct from old.data->'qty' or new.deleted is distinct from old.deleted) and current_setting('phonefix.trade_write',true) is distinct from 'yes' then raise exception 'This item has a pending billing stock sync. Refresh billing and wait for the Inventory sheet backup before changing its quantity';end if;
 return new;end $$;
create trigger pf_trade_stock_guard before update on public.pf_records for each row execute function phonefix_private.guard_pending_trade_stock();
create function public.pf_trade_stock() returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();begin
 if not phonefix_private.record_permission('inventory') and a->>'role' not in ('developer','owner','manager') then raise exception 'Inventory access required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('kind',r.kind,'id',r.record_id,'data',r.data)) from public.pf_records r where not r.deleted and exists(select 1 from public.pf_trade_entries e where not e.synced and e.source_kind=r.kind and e.source_id=r.record_id)),'[]'::jsonb);end $$;
revoke all on function public.pf_trade_stock() from public,anon;
grant execute on function public.pf_trade_stock() to authenticated;
create function public.pf_trade_sheet_pull(token text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from phonefix_private.operations_sheet_connector where token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'Invalid connector token';end if;
 return jsonb_build_object('sheet_id','1xAIQT635B6m38KxAFCpaJe97Ist4csrwROVoMSECW80','records',coalesce((select jsonb_agg(to_jsonb(e)-'request'||jsonb_build_object('account_name',a.name,'account_kind',a.kind)) from public.pf_trade_entries e join public.pf_trade_accounts a on a.id=e.account_id where not e.synced),'[]'::jsonb));end $$;
create function public.pf_trade_sheet_ack(token text,records jsonb) returns void language plpgsql security definer set search_path='' as $$declare x jsonb;begin
 if not exists(select 1 from phonefix_private.operations_sheet_connector where token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'Invalid connector token';end if;
 for x in select * from jsonb_array_elements(records) loop update public.pf_trade_entries set synced=coalesce((x->>'ok')::boolean,false),sync_error=nullif(left(x->>'error',500),'') where id=(x->>'id')::uuid;end loop;end $$;
create function public.pf_master_backup() returns jsonb language plpgsql security definer set search_path='' as $$declare a jsonb:=phonefix_private.operations_actor();result jsonb;tbl text;v jsonb;begin
 if a->>'role'<>'developer' then raise exception 'Developer access required';end if;
 result:=jsonb_build_object('format','phonefix-business-backup','version',1,'created_at',now(),'created_by',a->>'email');
 foreach tbl in array array['pf_records','pf_operations','pf_operations_audit','pf_trade_accounts','pf_trade_entries','pf_attendance','pf_audit','pf_members','pf_settings','pf_sheet_archive'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',tbl) into v;result:=result||jsonb_build_object(tbl,v);
 end loop;return result;end $$;
revoke all on function public.pf_trade_list(),public.pf_trade_save(jsonb),public.pf_master_backup() from public,anon;
grant execute on function public.pf_trade_list(),public.pf_trade_save(jsonb),public.pf_master_backup() to authenticated;
revoke all on function public.pf_trade_sheet_pull(text),public.pf_trade_sheet_ack(text,jsonb) from public;
grant execute on function public.pf_trade_sheet_pull(text),public.pf_trade_sheet_ack(text,jsonb) to anon,authenticated;
commit;
