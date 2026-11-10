begin;
alter table public.pf_trade_accounts add column employee_location text not null default '';
create unique index pf_trade_custom_employee on public.pf_trade_accounts(lower(trim(name)),lower(trim(employee_location))) where kind='employee' and employee_id is null;
alter table public.pf_trade_entries add column deleted_at timestamptz, add column deleted_by text, add column deletion_reason text, add column deletion_id uuid unique, add column deletion_synced boolean not null default false;
create or replace function public.pf_trade_save(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();rid uuid:=(payload->>'id')::uuid;aid uuid;atype text:=payload->>'account_kind';nm text:=trim(payload->>'account_name');uid uuid:=(payload->>'employee_id')::uuid;k text:=payload->>'kind';d date:=(payload->>'day')::date;q integer;cost bigint;price bigint;amt bigint;paid bigint:=coalesce((payload->>'paid')::bigint,0);r public.pf_trade_entries;stock public.pf_records;after_stock jsonb;sk text:=payload->>'source_kind';sid text:=payload->>'source_id';item_name text:=trim(payload->>'item');
begin
 if a->>'role' not in ('developer','owner','manager') then raise exception 'Manager access required';end if;
 if rid is null or d is null or d>(now() at time zone 'America/New_York')::date or k is null or k not in ('sale','payment') then raise exception 'Invalid transaction';end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));select * into r from public.pf_trade_entries where id=rid;
 if r.id is not null then if r.request<>payload then raise exception 'This request was already saved with different values';end if;return (to_jsonb(r)-'request')||jsonb_build_object('replayed',true);end if;
 if atype is null or atype not in ('store','employee') or nm is null or length(nm) not between 1 and 160 then raise exception 'Enter a store or employee name';end if;
 if atype='employee' and uid is not null and (not exists(select 1 from public.pf_members where user_id=uid and store_id='philadelphia' and revoked_at is null)) then raise exception 'Select an active employee';end if;
 if length(coalesce(payload->>'employee_location',''))>160 then raise exception 'Branch name is too long';end if;
 if length(coalesce(payload->>'description',''))>4000 then raise exception 'Notes are too long';end if;
 perform pg_advisory_xact_lock(hashtextextended('trade-account:'||atype||':'||case when atype='employee' then coalesce(uid::text,lower(nm)||':'||lower(trim(coalesce(payload->>'employee_location','')))) else lower(nm) end,0));
 select id into aid from public.pf_trade_accounts where kind=atype and (atype='store' and lower(trim(name))=lower(nm) or atype='employee' and (employee_id=uid or uid is null and employee_id is null and lower(trim(name))=lower(nm) and lower(trim(employee_location))=lower(trim(coalesce(payload->>'employee_location','')))));
 if aid is null then insert into public.pf_trade_accounts(kind,name,employee_id,employee_location,created_by) values(atype,nm,case when atype='employee' then uid end,case when atype='employee' and uid is null then trim(coalesce(payload->>'employee_location','')) else '' end,a->>'email') returning id into aid;end if;
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

create function public.pf_trade_delete(entry_id uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare a jsonb:=phonefix_private.operations_actor();r public.pf_trade_entries;root_id uuid;begin
 if a->>'role' not in ('developer','owner','manager') then raise exception 'Manager access required';end if;
 if length(trim(coalesce(reason,''))) not between 3 and 1000 then raise exception 'Enter a reason for deletion';end if;
 select * into r from public.pf_trade_entries where id=entry_id;
 if r.id is null then raise exception 'Billing entry not found';end if;
 root_id:=coalesce((r.request->>'id')::uuid,r.id);
 perform pg_advisory_xact_lock(hashtextextended(root_id::text,0));
 select * into r from public.pf_trade_entries where id=entry_id for update;
 if r.deleted_at is not null then return;end if;
 -- Preserve inventory and the original ledger; the Sheet receives an explicit deletion audit row.
 update public.pf_trade_entries set deleted_at=clock_timestamp(),deleted_by=a->>'email',deletion_reason=trim(reason),deletion_id=gen_random_uuid()
 where deleted_at is null and (id=entry_id or r.kind='sale' and kind='payment' and request->>'id'=entry_id::text);
end $$;
revoke all on function public.pf_trade_delete(uuid,text) from public,anon;
grant execute on function public.pf_trade_delete(uuid,text) to authenticated;
create or replace function public.pf_trade_sheet_pull(token text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from phonefix_private.operations_sheet_connector where token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'Invalid connector token';end if;
 return jsonb_build_object('sheet_id','1xAIQT635B6m38KxAFCpaJe97Ist4csrwROVoMSECW80','records',coalesce((select jsonb_agg(x.record) from (
 select to_jsonb(e)-'request'||jsonb_build_object('account_name',a.name||case when a.employee_location<>'' then ' — '||a.employee_location else '' end,'account_kind',a.kind) as record from public.pf_trade_entries e join public.pf_trade_accounts a on a.id=e.account_id where not e.synced
 union all
 select jsonb_build_object('id',e.deletion_id,'account_id',e.account_id,'account_name',a.name,'account_kind',a.kind,'day',e.day,'kind','deleted','amount',0,'description','DELETED '||e.kind||' '||e.id||' ('||e.amount||' cents). Reason: '||e.deletion_reason||'. Stock unchanged.','created_by',e.deleted_by,'created_at',e.deleted_at) from public.pf_trade_entries e join public.pf_trade_accounts a on a.id=e.account_id where e.deleted_at is not null and not e.deletion_synced
 ) x),'[]'::jsonb));end $$;
create or replace function public.pf_trade_sheet_ack(token text,records jsonb) returns void language plpgsql security definer set search_path='' as $$declare x jsonb;begin
 if not exists(select 1 from phonefix_private.operations_sheet_connector where token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'Invalid connector token';end if;
 for x in select * from jsonb_array_elements(records) loop
 update public.pf_trade_entries set synced=coalesce((x->>'ok')::boolean,false),sync_error=nullif(left(x->>'error',500),'') where id=(x->>'id')::uuid;
 update public.pf_trade_entries set deletion_synced=coalesce((x->>'ok')::boolean,false) where deletion_id=(x->>'id')::uuid;
 end loop;end $$;
commit;
