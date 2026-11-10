const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require.resolve('../site/assets/sync.js'), 'utf8');

function environment(shared = new Map()) {
  class Storage {
    get length() { return shared.size; }
    key(i) { return [...shared.keys()][i] ?? null; }
    getItem(k) { return shared.get(k) ?? null; }
    setItem(k, v) { if (this.fail?.(k)) throw Error('Quota exceeded'); shared.set(String(k), String(v)); }
    removeItem(k) { shared.delete(k); }
  }
  const storage = new Storage(), timers = [], statuses = [], requests = [];
  let transport = async () => {};
  const ctx = vm.createContext({ Storage, crypto: webcrypto, navigator: { onLine: true },
    Event: class {}, dispatchEvent() {}, addEventListener() {},
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} });
  vm.runInContext(source, ctx);
  const start = (permissions={}) => ctx.PhoneFixSync.start({ ...permissions, storage, device: 'test-device',
    request: async (path, options) => { requests.push(JSON.parse(options.body).events); return transport(); },
    onChange: value => statuses.push(value) });
  return { storage, start, statuses, requests, ctx, transport: fn => { transport = fn; } };
}
const save = (env, value) => env.storage.setItem('phoneRepairIntakes', JSON.stringify(value));

test('initial backup retains every field and retries a failed request without blocking original storage', async () => {
  const env = environment();
  const record = { id:'FIX-test', name:'Test', custom:{ warranty:7 }, price:108 };
  save(env, [record]); const sync = env.start();
  env.transport(async () => { throw Error('Offline test'); });
  await sync.flush(); assert.equal(sync.pending(), 1);
  assert.deepEqual(env.requests[0][0].data, record);
  assert.equal(env.requests[0][0].version, 1);
  env.transport(async () => {}); await sync.flush(); assert.equal(sync.pending(), 0);
  assert.deepEqual(JSON.parse(env.storage.getItem('phoneRepairIntakes')), [record]);
});
test('a save during an in-flight request remains queued after the old event is acknowledged', async () => {
  const env = environment(), sync = env.start(); save(env, [{id:'A',price:10}]);
  let release; env.transport(() => new Promise(resolve => { release = resolve; }));
  const inflight = sync.flush(); save(env, [{id:'A',price:20}]); release(); await inflight;
  assert.equal(sync.pending(), 1);
  env.transport(async () => {}); await sync.flush();
  assert.equal(env.requests[1][0].data.price, 20); assert.equal(sync.pending(), 0);
});
test('two browser tabs retain independent pending edits and deletion markers', async () => {
  const shared = new Map(), a = environment(shared), b = environment(shared);
  const sa = a.start(), sb = b.start();
  save(a, [{id:'A',price:1}]); save(b, [{id:'A',price:1},{id:'B',price:2}]); save(a, [{id:'B',price:2}]);
  assert.equal(sa.pending(), 3); assert.equal(sb.pending(), 3);
  await sb.flush(); assert.equal(sa.pending(), 0);
  assert.equal(b.requests[0].filter(e => e.deleted && e.id === 'A').length, 1);
});
test('mirror quota failures do not cancel the original Google-sync data write', () => {
  const env = environment(); env.start(); env.storage.fail = k => k.startsWith('pf.supabase.event.');
  assert.doesNotThrow(() => save(env, [{id:'A'}]));
  assert.equal(JSON.parse(env.storage.getItem('phoneRepairIntakes'))[0].id, 'A');
  assert.match(env.statuses.at(-1).error, /could not be saved/);
  env.storage.fail = k => k === 'phoneRepairIntakes';
  assert.throws(() => save(env, []), /Quota exceeded/);
});
test('unrelated auth/dirty state is not mirrored; old outbox survives an upgrade', async () => {
  const env = environment();
  env.storage.setItem('pf.supabase.outbox.v1', JSON.stringify({'repairs:A':{kind:'repairs',id:'A',data:{id:'A'},version:2,deleted:false}}));
  const sync = env.start();
  env.storage.setItem('pf.auth.session.v1', '{"token":"not-to-be-mirrored"}');
  env.storage.setItem('phoneRepairDirty', '{}');
  assert.equal(sync.pending(),1); await sync.flush();
  assert.equal(env.requests[0][0].kind,'repairs'); assert.equal(sync.pending(),0);
});
test('offline work stays queued and batches never exceed the server limit', async () => {
  const env = environment(), sync = env.start();
  save(env, Array.from({length:150}, (_,i) => ({id:String(i)})));
  env.ctx.navigator.onLine = false; await sync.flush(); assert.equal(env.requests.length,0);
  env.ctx.navigator.onLine = true;
  await sync.flush(); await sync.flush(); await sync.flush();
  assert.deepEqual(env.requests.map(batch => batch.length), [70,70,10]); assert.equal(sync.pending(),0);
});

test('restricted account backs up permitted edits while retaining blocked pending events for a manager',async()=>{
 const e=environment();e.storage.setItem('pf.supabase.event.v2:other',JSON.stringify({kind:'inventory',id:'PHONE',data:{imei:'PHONE'},version:1}));
 let manager=false;const sync=e.start({canCapture:event=>event.kind==='repairs',canSend:event=>manager||event.kind==='repairs'});
 e.storage.setItem('phoneRepairInventory',JSON.stringify([{imei:'NEW'}]));save(e,[{id:'TICKET',name:'Fixture'}]);await sync.flush();
 assert.equal(e.requests.length,1);assert.equal(e.requests[0].length,1);assert.equal(e.requests[0][0].kind,'repairs');assert.equal(sync.pending(),1);
 manager=true;await sync.flush();assert.equal(sync.pending(),0);assert.equal(e.requests[1][0].id,'PHONE');
});
