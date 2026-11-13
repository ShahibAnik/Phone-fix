begin;
-- Private, durable inbox. Only the constrained submission API can append to it.
create table if not exists phonefix_private.public_checkins (
 request_id uuid primary key,
 phone text not null,
 input jsonb not null,
 record jsonb not null,
 created_at timestamptz not null default now(),
 sheet_sent_at timestamptz
);
alter table phonefix_private.public_checkins enable row level security;
revoke all on phonefix_private.public_checkins from public,anon,authenticated;
create index if not exists public_checkins_created on phonefix_private.public_checkins(created_at);
create index if not exists public_checkins_phone_created on phonefix_private.public_checkins(phone,created_at);
create index if not exists public_checkins_pending on phonefix_private.public_checkins(created_at) where sheet_sent_at is null;

create or replace function phonefix_private.public_checkin_submit(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare req uuid; input_phone text; name text; device text; notes text; code text; clean jsonb; prior phonefix_private.public_checkins; ticket jsonb; rec jsonb; ms bigint; stamp text; display_time text;
begin
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>12000 then raise exception 'Invalid check-in'; end if;
 req:=(payload->>'requestId')::uuid;
 name:=trim(payload->>'name');input_phone:=payload->>'phone';device:=trim(payload->>'device');notes:=trim(payload->>'notes');code:=trim(payload->>'code');
 if req is null or coalesce(length(name),0) not between 2 and 100 or coalesce(input_phone,'') !~ '^[0-9]{10}$' or coalesce(length(device),0) not between 2 and 150 or coalesce(length(notes),0) not between 1 and 2000 or coalesce(length(code),0) not between 1 and 100 then raise exception 'Enter a valid name, phone, device, passcode and repair issue'; end if;
 clean:=jsonb_build_object('name',name,'phone',input_phone,'device',device,'notes',notes,'code',code,'priority',coalesce((payload->>'priority')::boolean,false));
 -- A global lock makes quota checks and allocation atomic under concurrent calls.
 perform pg_advisory_xact_lock(hashtextextended('phonefix-public-checkin',0));
 select * into prior from phonefix_private.public_checkins where request_id=req;
 if found then
  if prior.input is distinct from clean then raise exception 'This request was already used for a different check-in'; end if;
  return jsonb_build_object('id',prior.record->>'id','createdAt',prior.record->'createdAt');
 end if;
 if (select count(*) from phonefix_private.public_checkins where created_at>now()-interval '1 minute')>=120 or
    (select count(*) from phonefix_private.public_checkins c where c.phone=input_phone and created_at>now()-interval '24 hours')>=5 then
  raise exception 'Check-in limit reached. Please visit the counter';
 end if;
 ticket:=phonefix_private.allocate_identifier('ticket',0);
 ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;stamp:=ticket->>'stamp';display_time:=to_char(timezone('America/New_York',clock_timestamp()),'Mon DD, YYYY HH12:MI AM');
 rec:=jsonb_build_object('id',ticket->>'id','customerId','','name',name,'phone',input_phone,'device',device,'code',code,'notes',notes,'fixedBy','','price',0,'subtotal',0,'taxAmount',0,'totalAmount',0,'priceFormatted','$0.00','subtotalFormatted','$0.00','taxFormatted','$0.00','totalFormatted','$0.00','isTaxable',false,'isPaid',false,'isDelivered',false,'selfIntake',true,'queueStatus','queued','queueDay',stamp,'queueSerial',(ticket->>'seq')::bigint,'priority',clean->'priority','warrantyDays',7,'createdAt',ms,'dateDisplay',display_time,'intakeAt',display_time,'updatedAt',display_time,'statusChangedAt',display_time);
 insert into phonefix_private.public_checkins(request_id,phone,input,record) values(req,input_phone,clean,rec);
 return jsonb_build_object('id',ticket->>'id','createdAt',ms);
end $$;
revoke all on function phonefix_private.public_checkin_submit(jsonb) from public;
grant execute on function phonefix_private.public_checkin_submit(jsonb) to anon,authenticated;
create or replace function public.pf_public_checkin_submit(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select phonefix_private.public_checkin_submit(payload) $$;
revoke all on function public.pf_public_checkin_submit(jsonb) from public;
grant execute on function public.pf_public_checkin_submit(jsonb) to anon,authenticated;

create or replace function public.pf_public_checkin_pending() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not phonefix_private.can('repair_create') then raise exception 'Repair creation permission required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('requestId',request_id,'record',record)) from (select * from phonefix_private.public_checkins where sheet_sent_at is null order by created_at limit 100) q),'[]'::jsonb);
end $$;
revoke all on function public.pf_public_checkin_pending() from public,anon;
grant execute on function public.pf_public_checkin_pending() to authenticated;
create or replace function public.pf_public_checkin_ack(request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not phonefix_private.can('repair_create') then raise exception 'Repair creation permission required';end if;
 update phonefix_private.public_checkins c set sheet_sent_at=now() where c.request_id=pf_public_checkin_ack.request_id and sheet_sent_at is null;
end $$;
revoke all on function public.pf_public_checkin_ack(uuid) from public,anon;
grant execute on function public.pf_public_checkin_ack(uuid) to authenticated;
commit;
