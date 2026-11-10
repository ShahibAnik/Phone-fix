/* Independent Supabase mirror. Original Google Sheets functions are untouched. */
(function (root) {
  'use strict';
  const ENTITIES = {
    phoneRepairIntakes: ['repairs', 'id'],
    phoneRepairCustomerProfiles: ['customers', '$object'],
    phoneRepairInventory: ['inventory', 'imei'],
    phoneRepairParts: ['parts', 'sku'],
    phoneRepairAcc: ['accessories', 'sku'],
    phoneRepairAccLists: ['accessory_lists', '$single'],
    phoneRepairPartSections: ['section_lists', '$single'],
    phoneRepairPartUsage: ['usage', 'id'],
    phoneRepairSpecialOrders: ['special_orders', 'id'],
    phoneRepairStoreCredit: ['store_credit', 'id'],
    phoneRepairToOrder: ['reorder', 'sku'],
    phoneRepairPartLists: ['part_lists', '$single']
  };
  const COUNTERS = ['phoneRepairCounter','phoneRepairQueueCounter','phoneRepairDepositNos','phoneRepairDepositCounter','phoneRepairSOCounter','phoneRepairCredCounter','phoneRepairSORcptCounter'];
  const OUTBOX = 'pf.supabase.outbox.v1';
  const EVENT_PREFIX = 'pf.supabase.event.v2:';
  function parse(raw, fallback) { try { return JSON.parse(raw) ?? fallback; } catch (_) { return fallback; } }
  function records(raw, key, device) {
    const config = ENTITIES[key];
    if (!config) return COUNTERS.includes(key) ? { [device + ':' + key]: parse(raw, {}) } : {};
    const data = parse(raw, config[1] === '$object' ? {} : []);
    if (config[1] === '$single') return { settings: data };
    if (config[1] === '$object') return data && !Array.isArray(data) && typeof data === 'object' ? data : {};
    return Object.fromEntries((Array.isArray(data) ? data : []).filter(x => x && x[config[1]] != null).map(x => [String(x[config[1]]), x]));
  }
  function changes(before, after, kind, version, initial) {
    const result = [];
    for (const [id, data] of Object.entries(after)) {
      if (JSON.stringify(before[id]) !== JSON.stringify(data)) result.push({ kind, id, data, version, deleted: false });
    }
    if (!initial) for (const id of Object.keys(before)) {
      if (!(id in after)) result.push({ kind, id, data: {}, version, deleted: true });
    }
    return result;
  }
  function start({ storage, request, onChange, device, canCapture = () => true, canSend = () => true }) {
    let busy = false, retry = 0, timer, lastVersion = Date.now();
    const original = Storage.prototype.setItem;
    const tracked = key => key in ENTITIES || COUNTERS.includes(key);
    // Immutable event keys keep two open tabs from overwriting each other's queue.
    // Removing an acknowledged key can never remove a newer edit to that record.
    function pending() {
      const entries = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(EVENT_PREFIX)) {
          const event = parse(storage.getItem(key), null);
          if (event && typeof event.kind === 'string' && event.id != null) entries.push({ key, event });
        }
      }
      return entries.sort((a,b) => a.event.version - b.event.version);
    }
    function enqueue(event) { original.call(storage, EVENT_PREFIX + crypto.randomUUID(), JSON.stringify(event)); }
    function status(error) { onChange?.({ pending: pending().length, busy, error: error || '', lastSuccess: storage.getItem('pf.supabase.lastSuccess') }); }
    function capture(key, before, after, initial = false) {
      const kind = ENTITIES[key]?.[0] || 'device_settings';
      const version = initial ? 1 : (lastVersion = Math.max(Date.now(), lastVersion + 1));
      for (const event of changes(records(before, key, device), records(after, key, device), kind, version, initial)) {
        if(canCapture(event,before===null?null:records(before,key,device)[event.id]))enqueue(event);
      }
      status(); schedule(800);
    }
    Storage.prototype.setItem = function (key, value) {
      const watch = this === storage && tracked(key), before = watch ? this.getItem(key) : null;
      const result = original.apply(this, arguments); // Preserve original throws and return value.
      if (watch && before !== String(value)) {
        try { capture(key, before, String(value)); } catch (_) { status('Backup queue could not be saved. Free browser storage and retry.'); }
        root.dispatchEvent?.(new Event('pf:data'));
      }
      return result;
    };
    function schedule(delay) { clearTimeout(timer); timer = setTimeout(flush, delay); }
    async function flush() {
      if (busy || !pending().length) return status();
      if (typeof navigator !== 'undefined' && !navigator.onLine) { status('Offline · changes are queued'); schedule(15000); return; }
      busy = true; status();
      const entries = pending().filter(item=>canSend(item.event)).slice(0,70), batch=entries.map(item=>item.event);
      if(!entries.length){busy=false;return status('Some backups require a manager to sign in on this device.');}
      try {
        await request('/rest/v1/rpc/pf_mirror', { method: 'POST', body: JSON.stringify({ events: batch }) });
        for (const {key} of entries) storage.removeItem(key);
        retry = 0;
        original.call(storage, 'pf.supabase.lastSuccess', new Date().toISOString());
        busy = false; status(); if (pending().length) schedule(100);
      } catch (error) {
        busy = false; status(error.message || 'Sync failed · changes remain queued');
        schedule(Math.min(60000, 2000 * 2 ** Math.min(retry++, 5)));
      }
    }
    const legacy = parse(storage.getItem(OUTBOX), {});
    try {
      if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) Object.values(legacy).forEach(enqueue);
      storage.removeItem(OUTBOX);
    } catch (_) { status('Backup queue could not be upgraded. Free browser storage and retry.'); }
    for (const key of [...Object.keys(ENTITIES), ...COUNTERS]) {
      const current = storage.getItem(key);
      if (current != null) try { capture(key, null, current, true); } catch (_) { status('Could not prepare backup queue'); }
    }
    root.addEventListener?.('online', () => schedule(0));
    root.addEventListener?.('storage', event => { if (event.key?.startsWith(EVENT_PREFIX)) { status(); schedule(500); } });
    status();
    schedule(800);
    return { flush, pending: () => pending().length };
  }
  root.PhoneFixSync = { start, records, changes, ENTITIES, COUNTERS };
  if (typeof module !== 'undefined') module.exports = root.PhoneFixSync;
})(typeof window !== 'undefined' ? window : globalThis);
