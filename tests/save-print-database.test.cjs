// Local PostgreSQL only: npm install --prefix /tmp/phonefix-sql-tests @electric-sql/pglite@0.3.14
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require('/tmp/phonefix-sql-tests/node_modules/@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
test('local PostgreSQL: canonical/legacy creation permissions, roles, RLS and both ID APIs',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema phonefix_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table public.pf_members(user_id uuid,store_id text default 'philadelphia',role text,team_role text,permissions text[],revoked_at timestamptz);
 create table phonefix_private.pin_credentials(user_id uuid,version bigint);
 create table phonefix_private.pin_sessions(user_id uuid,version bigint,session_id text,expires_at timestamptz);
 create table phonefix_private.identifier_counters(counter_key text primary key,value bigint check(value>=0),updated_at timestamptz default now());
 alter table phonefix_private.identifier_counters enable row level security;
 create table public.pf_records(store_id text,kind text,record_id text,data jsonb,deleted boolean default false);
 alter table public.pf_records enable row level security;
 grant usage on schema auth,phonefix_private to authenticated,anon;
 grant select,insert on public.pf_records to authenticated;
 `);
 await db.exec(fs.readFileSync(path.join(root,'database/save-print-permissions.sql'),'utf8'));
 // Install the existing production record guard, without changing it.
 const granular=fs.readFileSync(path.join(root,'database/granular-permissions.sql'),'utf8');
 await db.exec(granular.slice(granular.indexOf('create or replace function phonefix_private.guard_record_change'),granular.indexOf('drop policy if exists records_read')));
 await db.exec(`grant execute on function phonefix_private.can(text) to authenticated;
 create trigger record_guard before insert on public.pf_records for each row execute function phonefix_private.guard_record_change();
 create policy create_records on public.pf_records for insert to authenticated with check(store_id='philadelphia' and kind in ('repairs','customers') and phonefix_private.can('repair_create'));
 create policy read_records on public.pf_records for select to authenticated using(store_id='philadelphia' and phonefix_private.can('repair_create'));
 `);
 let index=0;
 for(const [role,perms,allowed] of [['developer',[],true],['owner',[],true],['manager',null,true],['manager',['repair_create'],true],['employee',['repair_create'],true],['manager',['intake_create'],true],['employee',['intake_create'],true],['manager',[],false],['employee',[],false],['employee',['repair_view','payment_record','inventory_view'],false]]){
  const uid=`00000000-0000-4000-8000-${String(++index).padStart(12,'0')}`;
  await db.query('insert into pf_members(user_id,role,team_role,permissions) values ($1,$2,$2,$3)',[uid,role,perms]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');
  for(const kind of ['customer','ticket']){
   if(allowed){const r=await db.query(`select public.pf_reserve_${kind}_id(10000) as r`);assert.ok(r.rows[0].r.id.endsWith(String(r.rows[0].r.seq)));assert.ok(r.rows[0].r.seq>10000);}
   else await assert.rejects(db.query(`select public.pf_reserve_${kind}_id(0)`),/reservation denied/);
  }
  if(allowed){
   const a=await db.query("select phonefix_private.can('repair_create') canonical,phonefix_private.can('intake_create') legacy");assert.equal(a.rows[0].canonical,true);assert.equal(a.rows[0].legacy,true);
   await db.query("insert into pf_records(store_id,kind,record_id,data) values ('philadelphia','repairs',$1,'{}'),('philadelphia','customers',$1,'{}')",[uid]);
   if(perms&&['manager','employee'].includes(role)){for(const p of ['team_manage','inventory_edit','customer_edit','repair_edit','payment_record'])assert.equal((await db.query('select phonefix_private.can($1) allowed',[p])).rows[0].allowed,false);}
  }else await assert.rejects(db.exec("insert into pf_records(store_id,kind,record_id,data) values ('philadelphia','repairs','DENIED','{}')"),/permission|policy/i);
  await db.exec('reset role');
 }
 // Revoked membership and PIN-locked accounts must not reserve either kind.
 const uid='00000000-0000-4000-8000-000000000099';
 await db.query("insert into pf_members(user_id,role,team_role,permissions,revoked_at) values ($1,'employee','employee',array['repair_create'],now())",[uid]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 for(const state of ['revoked','locked']){
  if(state==='locked'){await db.query('update pf_members set revoked_at=null where user_id=$1',[uid]);await db.query('insert into phonefix_private.pin_credentials values ($1,1)',[uid]);}
  await db.exec('set role authenticated');for(const kind of ['customer','ticket'])await assert.rejects(db.query(`select public.pf_reserve_${kind}_id()`),/reservation denied/);await db.exec('reset role');
 }
 const before=await db.query('select * from phonefix_private.identifier_counters order by counter_key');
 await db.exec("select set_config('request.jwt.claim.sub','',false);set role anon");
 for(const kind of ['customer','ticket'])await assert.rejects(db.query(`select public.pf_reserve_${kind}_id()`),/permission denied/);
 await db.exec('reset role');assert.deepEqual((await db.query('select * from phonefix_private.identifier_counters order by counter_key')).rows,before.rows);
 // Public submission has a separate capability: append a validated check-in,
 // never reserve arbitrary IDs or read another customer's submission.
 await db.exec(fs.readFileSync(path.join(root,'database/public-checkin.sql'),'utf8'));
 await db.exec('set role anon');
 const payload={requestId:'10000000-0000-4000-8000-000000000001',name:'Public fixture',phone:'2155550199',device:'Test phone',code:'1234',notes:'Screen issue',priority:false};
 const submitted=(await db.query('select public.pf_public_checkin_submit($1) result',[payload])).rows[0].result;
 assert.ok(submitted.id.startsWith('FIX-'));
 assert.deepEqual((await db.query('select public.pf_public_checkin_submit($1) result',[payload])).rows[0].result,submitted);
 await assert.rejects(db.query('select public.pf_public_checkin_submit($1)',[{...payload,name:'Changed'}]),/different check-in/);
 await assert.rejects(db.exec('select * from phonefix_private.public_checkins'),/permission denied/);
 await assert.rejects(db.exec('select public.pf_public_checkin_pending()'),/permission denied/);
 await assert.rejects(db.exec("select phonefix_private.allocate_identifier('ticket',0)"),/permission denied/);
 await assert.rejects(db.query('select public.pf_public_checkin_submit($1)',[{...payload,requestId:'10000000-0000-4000-8000-000000000002',phone:'bad'}]),/valid name/);
 for(let n=2;n<=5;n++)await db.query('select public.pf_public_checkin_submit($1)',[{...payload,requestId:`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`}]);
 await assert.rejects(db.query('select public.pf_public_checkin_submit($1)',[{...payload,requestId:'10000000-0000-4000-8000-000000000006'}]),/limit reached/);
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-4000-8000-000000000005']);
 await db.exec('set role authenticated');
 assert.equal((await db.query('select public.pf_public_checkin_pending() result')).rows[0].result.length,5);
 await db.query('select public.pf_public_checkin_ack($1)',[payload.requestId]);
 assert.equal((await db.query('select public.pf_public_checkin_pending() result')).rows[0].result.length,4);
 await db.exec('reset role');
 assert.equal((await db.query('select count(*)::integer n from phonefix_private.public_checkins')).rows[0].n,5);
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.pf_records'::regclass")).rows[0].relrowsecurity,true);
 }finally{await db.close();}
});
