/* ESP32Health v0.1.0 | MIT | https://github.com/JRJenZens/ESP32Health */
export const VERSION = '0.1.0';
export const ROLES = {
  MR60BHA2: { presence: 'Tilstedeværelse', heart_rate: 'Puls', breath_rate: 'Vejrtrækning', distance: 'Afstand', num_targets: 'Antal personer (estimat)', illuminance: 'Lysniveau' },
  MR60FDA2: { presence: 'Tilstedeværelse', fall: 'Fald registreret', illuminance: 'Lysniveau' },
};
export const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, digits = 0) => Number.isFinite(n) ? new Intl.NumberFormat('da-DK', { maximumFractionDigits: digits }).format(n) : '—';
const time = (v) => new Date(v).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
export const connectionOnline = hass => Boolean(hass && (hass.connected ?? hass.connection?.connected ?? true));
const available = (s) => Boolean(s && !['unknown', 'unavailable', '', null, undefined].includes(s.state));
export function numberState(s) {
  if (!available(s) || typeof s.state === 'boolean' || !String(s.state).trim()) return null;
  const n = Number(s.state);
  return Number.isFinite(n) ? n : null;
}
export function binaryState(s) { return s?.state === 'on' ? true : s?.state === 'off' ? false : null; }
export function distanceMetres(s) {
  const n = numberState(s);
  const factor = { m: 1, cm: .01, mm: .001, ft: .3048, in: .0254 }[s?.attributes?.unit_of_measurement];
  return n === null || factor === undefined ? null : n * factor;
}
export function readingAge(s, now = Date.now()) {
  const updated = Date.parse(s?.last_reported || s?.last_updated);
  return Number.isFinite(updated) ? Math.max(0, (now - updated) / 1000) : Infinity;
}
export function validateConfig(config) {
  if (!config || !Array.isArray(config.devices)) throw new Error('devices skal være en liste.');
  if (config.devices.length > 50) throw new Error('Højst 50 enheder pr. kort.');
  const ids = new Set();
  for (const d of config.devices) {
    if (typeof d.id !== 'string' || !d.id || ids.has(d.id)) throw new Error('Alle enheder skal have et unikt id.');
    ids.add(d.id);
    if (!Object.hasOwn(ROLES,d.model)) throw new Error('Ukendt model: ' + d.model);
    if (!d.entities || typeof d.entities !== 'object' || Array.isArray(d.entities)) throw new Error('Enheden mangler entities.');
    for (const [role, entity] of Object.entries(d.entities)) {
      if (!(role in ROLES[d.model])) throw new Error('Ukendt sensortype: ' + role);
      if (entity && !new RegExp(`^${['presence', 'fall'].includes(role) ? 'binary_sensor' : 'sensor'}\\.[a-z0-9_]+$`).test(entity)) throw new Error('Forkert entitet til ' + role + ': ' + entity);
    }
  }
  if (config.stale_after !== undefined && (!Number.isFinite(config.stale_after) || config.stale_after < 30)) throw new Error('stale_after skal være mindst 30 sekunder.');
  return config;
}
export function evaluateBHA(device, states, connected = true, now = Date.now(), staleAfter = 180) {
  const s = (key) => states[device.entities[key]];
  if (!connected) return { kind: 'muted', label: 'Forbindelsen er afbrudt', usable: false };
  if (binaryState(s('presence')) === false) return { kind: 'muted', label: 'Ingen person registreret', usable: false };
  if (binaryState(s('presence')) !== true) return { kind: 'warn', label: 'Tilstedeværelse er ukendt', usable: false };
  if (numberState(s('num_targets')) !== 1) return { kind: 'warn', label: numberState(s('num_targets')) > 1 ? 'Flere personer · usikker måling' : 'Antal personer er ikke bekræftet', usable: false };
  const distance = distanceMetres(s('distance'));
  if (distance === null) return { kind: 'warn', label: 'Afstand eller måleenhed er ukendt', usable: false };
  if (distance < .5 || distance > 1.5) return { kind: 'warn', label: 'Uden for målezonen på 0,5–1,5 m', usable: false };
  if (['num_targets', 'distance', 'heart_rate', 'breath_rate'].some(k => readingAge(s(k), now) > staleAfter)) return { kind: 'warn', label: 'Opdateringstid er for gammel eller ukendt', usable: false };
  if (!(numberState(s('heart_rate')) > 0 && numberState(s('breath_rate')) > 0)) return { kind: 'warn', label: 'Afventer brugbar puls og vejrtrækning', usable: false };
  return { kind: 'good', label: 'Én person i målezonen', usable: true };
}
const rolePatterns = {
  presence: /has_target|people_exist|person_information|presence|tilstede|person information/i,
  heart_rate: /heart.?rate|heartbeat|puls/i,
  breath_rate: /breath.?rate|respiratory|respiration|vejrtr/i,
  distance: /distance|afstand/i,
  num_targets: /num.?targets|target.?number|target.?count|antal personer/i,
  fall: /fall|fald|falling/i,
  illuminance: /illuminance|illumin|lux|lysni/i,
};
export function discoverDevices(devices, entities, areas = [], states = {}) {
  return devices.flatMap(d => {
    const model = `${d.model || ''} ${d.name || ''} ${d.name_by_user || ''}`.match(/MR60(?:FDA2|BHA2)/i)?.[0]?.toUpperCase();
    if (!model) return [];
    const mapped = {};
    for (const [role] of Object.entries(ROLES[model])) {
      const domain = ['presence', 'fall'].includes(role) ? 'binary_sensor.' : 'sensor.';
      const candidates = entities.filter(e => e.device_id === d.id && !e.disabled_by && e.entity_id.startsWith(domain) && rolePatterns[role].test(`${e.entity_id} ${e.original_name || ''} ${e.name || ''} ${e.translation_key || ''} ${states[e.entity_id]?.attributes?.friendly_name || ''}`));
      // Ambiguous names are deliberately left for the user to choose.
      if (candidates.length === 1) mapped[role] = candidates[0].entity_id;
    }
    return [{ id: d.id, model, name: d.name_by_user || d.name || model, area: areas.find(a => a.area_id === d.area_id)?.name || '', entities: mapped }];
  });
}
export function normalizeHistory(result) {
  const output = {};
  for (const [id, rows] of Object.entries(result || {})) {
    output[id] = rows.map(r => ({ state: r.s ?? r.state, at: typeof (r.lu ?? r.lc) === 'number' ? (r.lu ?? r.lc) * 1000 : Date.parse(r.last_updated || r.last_changed) })).filter(r => Number.isFinite(r.at)).sort((a,b) => a.at - b.at);
  }
  return output;
}
export function toCSV(history, devices) {
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const metadata = new Map(devices.flatMap(d => Object.entries(d.entities).map(([r,id]) => [id,{name:d.name,role:r}])));
  return '\uFEFF' + [['timestamp_utc','device','entity_id','metric','state'], ...Object.entries(history).flatMap(([id, rows]) => rows.map(r => [new Date(r.at).toISOString(), metadata.get(id)?.name || '', id, metadata.get(id)?.role || '', r.state]))].map(row => row.map(v => cell(/^[=+@\-\t\r]/.test(String(v)) ? "'" + v : v)).join(',')).join('\r\n');
}
const icons = {
 pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
 breath: '<path d="M12 3v9m0-4c-3-6-8-1-8 5 0 6 6 6 8 2 2 4 8 4 8-2 0-6-5-11-8-5Z"/>',
 radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7"/><circle cx="12" cy="12" r="1"/>',
 shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
 grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
 arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.radar}</svg>`;
const css = `
:host{display:block;container-type:inline-size;color:#493238;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--green:#9d495d;--muted:#927b80;--line:#eee2e5;--bg:#fcf7f7;--ink:#4c3039}*{box-sizing:border-box}button,select,input{font:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.5}button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #cc98a8;outline-offset:3px}button svg{width:18px;height:18px}svg{width:24px;height:24px;flex-shrink:0}ha-card{display:block;overflow:hidden;background:var(--bg);border:1px solid var(--line);border-radius:20px;color:var(--ink)}.shell{display:grid;grid-template-columns:208px 1fr;min-height:740px}.side{padding:30px 20px;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:8px}.brand{display:flex;align-items:center;gap:9px;font-size:18px;font-weight:750;letter-spacing:-.8px;margin-bottom:35px}.brand svg{color:var(--green);width:30px;height:30px}.brand span span{font-weight:400}.caption{font-size:10px;letter-spacing:1.7px;color:var(--muted);font-weight:650;text-transform:uppercase}.nav{display:flex;align-items:center;gap:12px;border:0;background:none;text-align:left;border-radius:10px;color:#927b80;padding:12px;margin:3px 0}.nav.active{color:#97485b;background:#f8e9ed;font-weight:650}.side-foot{margin-top:auto;padding-top:48px;color:var(--muted);font-size:11px}.side-foot strong{display:block;color:#65464f;margin-bottom:6px}.body{padding:28px 34px 24px;min-width:0}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:34px}.breadcrumb{font-size:12px;color:var(--muted)}.breadcrumb b{color:#62414b;font-weight:500}.pill{border:1px solid #ead8df;border-radius:30px;background:#fff;font-size:11px;padding:6px 11px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.dot{height:6px;width:6px;border-radius:100%;background:#4b9d7c;display:inline-block}.muted .dot{background:#aa959b}.warn .dot{background:#bb8a34}.bad .dot{background:#b94444}h1{font-size:29px;letter-spacing:-1px;font-weight:600;line-height:1.2;margin:7px 0 10px}h2{font-size:16px;font-weight:650;letter-spacing:-.3px;margin:0}h3{font-size:13px;margin:0;font-weight:650}p{margin:6px 0}.sub{color:var(--muted);font-size:13px}.heading{display:flex;justify-content:space-between;align-items:end;gap:12px;margin-bottom:25px}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid #eadbdf;border-radius:8px;padding:8px 12px;background:#fff;color:#744b59;font-size:12px;text-decoration:none}.btn.primary{background:#a14e63;border-color:#a14e63;color:#fff}.demo{background:#fff4df;color:#80601d;border:1px solid #ebd7ab;padding:10px 14px;border-radius:10px;font-size:12px;margin-bottom:22px}.alert{padding:14px 17px;border-radius:12px;margin-bottom:18px;border:1px solid #e6b5b5;background:#fff1ef;color:#933d35;display:flex;gap:12px;align-items:center}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0 27px}.stat{padding:16px 18px;background:#fff;border:1px solid var(--line);border-radius:12px}.stat small{color:var(--muted);font-size:11px}.stat strong{font-size:23px;font-weight:600;display:block;letter-spacing:-.5px;margin:6px 0 2px}.stat em{font-style:normal;font-size:11px;color:var(--muted)}.section-head{display:flex;justify-content:space-between;align-items:center;margin:6px 0 14px}.section-head span{font-size:11px;color:var(--muted)}.devices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.device{background:#fff;border:1px solid var(--line);border-radius:15px;overflow:hidden}.device-header{display:flex;align-items:center;gap:10px;padding:19px 20px 15px}.device-icon{height:40px;width:40px;border-radius:11px;background:#faedf0;display:grid;place-items:center;color:#a76276}.device-header .text{flex:1;min-width:0}.device-header h2{font-size:14px}.model{font-size:10px;color:var(--muted);margin-top:2px}.sensor-body{padding:0 20px 18px}.measurements{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:18px 0}.metric-label{display:flex;align-items:center;gap:6px;font-size:11px;color:#977b85}.metric-label svg{height:16px;width:16px}.number{font-size:39px;font-weight:500;letter-spacing:-1.5px;line-height:1.4}.number span{font-size:11px;color:var(--muted);letter-spacing:0;margin-left:5px;font-weight:400}.hint{font-size:10px;color:var(--muted)}.status{padding:8px 10px;border-radius:7px;background:#eef5f0;color:#3a7356;font-size:10px;display:flex;gap:7px;align-items:center}.status.warn{background:#faf4e8;color:#8b6b2d}.status.muted{background:#f0f2f0;color:#748078}.status.bad{background:#fff0ed;color:#a1483d}.detail-row{display:flex;gap:12px;justify-content:space-between;border-top:1px solid var(--line);padding-top:13px;margin-top:14px;color:#a08b92;font-size:11px}.detail-row b{display:block;font-size:12px;font-weight:550;color:#72505b;margin-top:3px}.fall-visual{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:19px 0 17px;min-height:133px}.fall-visual .ring{width:56px;height:56px;border:1px solid #e3cdd5;box-shadow:0 0 0 9px #fcf4f6;border-radius:50%;display:grid;place-items:center;color:#5b8f6e;margin:0 0 16px}.fall-visual.bad .ring{color:#ad433c;background:#fff0ed;box-shadow:0 0 0 9px #fff6f4;border-color:#f1cbc5}.fall-visual strong{font-size:15px;font-weight:550}.panel{margin-top:22px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px}.chart-head{display:flex;justify-content:space-between;gap:15px;align-items:center}.chart-head p{font-size:11px;color:var(--muted)}select,input{background:#fff;border:1px solid #eadbdf;border-radius:7px;color:#744b59;padding:8px;max-width:100%;min-width:0}.chart{margin-top:15px}.chart svg{width:100%;height:160px;overflow:visible}.legend{display:flex;gap:16px;font-size:10px;color:#977b85;flex-wrap:wrap}.legend span::before{content:'';display:inline-block;width:7px;height:7px;background:#ad586d;border-radius:50%;margin-right:5px}.legend span:last-child::before{background:#c49381}.chart-empty{text-align:center;padding:30px;color:var(--muted);font-size:12px;border:1px dashed var(--line);border-radius:8px;margin-top:15px}.bottom{display:flex;justify-content:space-between;gap:15px;color:#a48e97;font-size:10px;padding-top:20px}.note{font-size:11px;color:#927b80;line-height:1.6}.badge{font-size:10px;background:#faeef2;color:#977580;border-radius:5px;padding:3px 6px}.empty{text-align:center;padding:50px 20px}.empty svg{width:42px;height:42px;color:var(--green)}.empty h2{margin:15px 0 8px}.empty .btn{margin-top:15px}.device-list{display:grid;gap:14px}.settings-device{border:1px solid var(--line);padding:16px;border-radius:12px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#947581}.field select,.field input{width:100%;font-size:12px}.settings-device .toolbar{justify-content:space-between;margin-bottom:16px}.error{padding:11px;background:#fff0ed;border-radius:7px;color:#a1483d;font-size:12px;margin:12px 0}.history-row{display:grid;grid-template-columns:100px 1fr auto;gap:12px;border-top:1px solid var(--line);padding:12px 0;font-size:12px}.history-row time{color:var(--muted)}.pending{padding:30px;text-align:center;color:var(--muted)}.wrap-name{overflow-wrap:anywhere}
@media(min-width:1250px){.body{padding:32px 44px}.number{font-size:43px}.sensor-body{padding:0 24px 22px}}
@container(max-width:900px){.shell{grid-template-columns:1fr}.side{padding:14px 22px;flex-direction:row;align-items:center;border-right:0;border-bottom:1px solid var(--line);gap:8px}.brand{margin:0 auto 0 0;font-size:16px}.brand svg{width:25px}.side .caption,.side-foot{display:none}.nav{padding:9px}.nav span{display:none}.body{padding:22px}.topbar{margin-bottom:24px}.shell{min-height:0}}
@container(max-width:760px){.devices{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr);gap:8px}.stat{padding:12px}.body{padding:18px 14px}.side{padding:13px 14px}.heading{align-items:start;flex-direction:column}h1{font-size:26px}.fields{grid-template-columns:1fr}.chart-head{align-items:start;flex-direction:column}.bottom{flex-direction:column}.device-header{padding:16px}.sensor-body{padding:0 16px 16px}.pill{font-size:10px}.history-row{grid-template-columns:70px 1fr auto}}
@media(prefers-reduced-motion:no-preference){.dot{transition:background .2s}}
`;

export class ESP32HealthCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._config = {type:'custom:esp32health-card',devices:[]};
    this._tab = 'overview'; this._history = {}; this._hours = 6; this._historyState = 'idle';
    this._signature = ''; this._error = ''; this._historyRequest = 0;
    this._connectionChanged=()=>{this._signature='';this.render();if(this._connected&&!this._editorMode){this._historyState='idle';void this.loadHistory();}};
    this.shadowRoot.addEventListener('click', e => this._click(e));
    this.shadowRoot.addEventListener('change', e => this._change(e));
  }
  static getConfigElement() { return document.createElement('esp32health-editor'); }
  static getStubConfig() { return {type:'custom:esp32health-card',title:'Dit hjem, i overblik',devices:[]}; }
  getCardSize() { return 12; }
  getGridOptions() { return {columns:'full',rows:'auto',min_columns:6}; }
  setConfig(config) {
    validateConfig(config);
    this._config = JSON.parse(JSON.stringify(config));
    this._historyRequest++; this._history = {}; this._historyState = 'idle'; this._signature = '';
    this.render();
  }
  set hass(hass) {
    this._hass = hass;
    if(this.isConnected)this._bindConnection();
    const signature = this._editorMode ? JSON.stringify([this._connected,Object.entries(hass.states || {}).map(([id,s])=>[id,s.attributes?.friendly_name])]) : JSON.stringify([this._connected, this._config.devices.map(d => Object.values(d.entities).map(id => hass.states?.[id]))]);
    if (signature !== this._signature) { this._signature = signature; this.render(); }
    if (!this._editorMode && this._historyState === 'idle' && this.isConnected && this._connected && this._config.devices.length) void this.loadHistory();
  }
  connectedCallback() {
    if(!this._editorMode)this._timer = setInterval(() => { if(this._tab!=='devices')this.render(); }, 15000);
    this._bindConnection();
    this.render();
    if (!this._editorMode && this._hass && this._historyState === 'idle' && this._config.devices.length) void this.loadHistory();
  }
  disconnectedCallback() { this._unbindConnection(); clearInterval(this._timer); this._historyRequest++; if(this._historyState === 'loading') this._historyState = 'idle'; }
  get _connected() { return connectionOnline(this._hass); }
  _unbindConnection(){if(this._connection){for(const event of ['ready','disconnected'])this._connection.removeEventListener?.(event,this._connectionChanged);}this._connection=null;}
  _bindConnection(){const conn=this._hass?.connection;if(conn===this._connection)return;this._unbindConnection();this._connection=conn;for(const event of ['ready','disconnected'])conn?.addEventListener?.(event,this._connectionChanged);}
  async loadHistory() {
    const ids = [...new Set(this._config.devices.flatMap(d => Object.values(d.entities)).filter(Boolean))];
    if (!this._connected || !ids.length || !this._hass.callWS) return;
    const request = ++this._historyRequest;
    const start=Date.now()-this._hours*3600000,end=Date.now();
    this._historyState = 'loading'; this._historyError = ''; this.render();
    try {
      const result = await this._hass.callWS({type:'history/history_during_period',start_time:new Date(start).toISOString(),end_time:new Date(end).toISOString(),entity_ids:ids,minimal_response:false,no_attributes:true,significant_changes_only:false});
      if (request !== this._historyRequest) return;
      this._history = normalizeHistory(result); this._historyStart=start; this._historyEnd=end; this._historyState = 'ready';
    } catch (_) {
      if (request !== this._historyRequest) return;
      this._history = {}; this._historyState = 'error';
      this._historyError = 'Historik kunne ikke hentes. Kontrollér, at History og Recorder er aktiveret, og at entiteterne bliver gemt.';
    }
    this.render();
  }
  async _discover() {
    this._error = ''; this._discovering = true; this.render();
    try {
      const [devices, entities, areas] = await Promise.all([
        this._hass.callWS({type:'config/device_registry/list'}),
        this._hass.callWS({type:'config/entity_registry/list'}),
        this._hass.callWS({type:'config/area_registry/list'}),
      ]);
      const found = discoverDevices(devices, entities, areas, this._hass.states);
      const existing = new Set(this._config.devices.map(d => d.id));
      const added = found.filter(d => !existing.has(d.id));
      if (!added.length) this._error = 'Ingen nye MR60FDA2/MR60BHA2-enheder fundet. Du kan tilføje enheden manuelt og vælge entiteterne.';
      else this._commit({...this._config,devices:[...this._config.devices,...added]});
    } catch (_) { this._error = 'Automatisk søgning kræver adgang til Home Assistants enhedsregister. Tilføj enheder manuelt, hvis din bruger ikke har adgang.'; }
    this._discovering = false; this.render();
  }
  _commit(config) {
    validateConfig(config);
    this._config = config; this._historyState = 'idle'; this._history = {}; this._historyRequest++;
    this.dispatchEvent(new CustomEvent('esp32health-config-changed',{detail:{config},bubbles:true,composed:true}));
    this.render();
  }
  _click(e) {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const action = b.dataset.action;
    if (action === 'tab') {this._tab = b.dataset.tab; this.render();}
    if (action === 'history') void this.loadHistory();
    if (action === 'discover' && this._connected) void this._discover();
    if (action === 'add') {
      const model = b.dataset.model;
      this._commit({...this._config,devices:[...this._config.devices,{id:globalThis.crypto?.randomUUID?.() || 'device-'+Date.now(),model,name:model === 'MR60BHA2' ? 'Puls og vejrtrækning' : 'Faldregistrering',area:'',entities:{}}]});
    }
    if (action === 'remove') this._commit({...this._config,devices:this._config.devices.filter(d=>d.id!==b.dataset.id)});
    if (action === 'csv' && this._historyState === 'ready') {
      const url = URL.createObjectURL(new Blob([toCSV(this._history,this._config.devices)],{type:'text/csv;charset=utf-8'}));
      const a = document.createElement('a'); a.href = url; a.download = `ESP32Health${this._hass?.demo ? '-DEMO' : ''}-${new Date().toISOString().slice(0,10)}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    if (action === 'yaml') {
      const text = JSON.stringify(this._config,null,2); // JSON is also valid YAML for HA's card editor.
      const url = URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const a = document.createElement('a'); a.href=url; a.download='ESP32Health-card.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  }
  _change(e) {
    const el = e.target;
    if (el.dataset.chartDevice) {this._chartDevice=el.value;this.render();return;}
    if (el.dataset.hours) { this._hours=Number(el.value); void this.loadHistory(); return; }
    const id = el.dataset.device; const key = el.dataset.key; if (!id || !key) return;
    const devices = this._config.devices.map(d => d.id!==id ? d : {...d,...(el.dataset.entity ? {entities:{...d.entities,[key]:el.value}} : {[key]:el.value})});
    this._commit({...this._config,devices});
  }
  _device(d) {
    const states = this._hass?.states || {}; const s = key => states[d.entities[key]];
    const ids = Object.values(d.entities).filter(Boolean);
    const isOnline = this._connected && ids.length > 0 && ids.some(id=>available(states[id]));
    const presence = this._connected ? binaryState(s('presence')) : null;
    const header = `<div class="device-header"><div class="device-icon">${icon(d.model==='MR60BHA2'?'pulse':'radar')}</div><div class="text"><h2 class="wrap-name">${escapeHTML(d.name)}</h2><div class="model">${escapeHTML(d.area || 'Område ikke valgt')} <span aria-hidden="true">·</span> ${d.model}</div></div><span class="pill ${isOnline?'':'muted'}"><i class="dot"></i>${isOnline?'Data tilgængelige':'Ingen data'}</span></div>`;
    const details = (entries) => `<div class="detail-row">${entries.map(([label,value])=>`<div>${label}<b>${escapeHTML(value)}</b></div>`).join('')}</div>`;
    const presenceLabel = presence===true?'Registreret':presence===false?'Ingen person':'Ukendt';
    const lux = this._connected ? numberState(s('illuminance')) : null;
    if(d.model==='MR60BHA2') {
      const quality = evaluateBHA(d,states,this._connected,Date.now(),this._config.stale_after || 180);
      const distance = this._connected ? distanceMetres(s('distance')) : null;
      return `<article class="device">${header}<div class="sensor-body"><div class="measurements"><div><div class="metric-label">${icon('pulse')}Puls</div><div class="number">${quality.usable?fmt(numberState(s('heart_rate'))):'—'}<span>slag/min</span></div><div class="hint">Radarens estimat</div></div><div><div class="metric-label">${icon('breath')}Vejrtrækning</div><div class="number">${quality.usable?fmt(numberState(s('breath_rate'))):'—'}<span>åndedrag/min</span></div><div class="hint">Radarens estimat</div></div></div><div class="status ${quality.kind}"><i class="dot"></i>${quality.label}</div>${details([['Tilstedeværelse',presenceLabel],['Antal (estimat)',this._connected?fmt(numberState(s('num_targets'))):'—'],['Afstand',distance===null?'Ukendt':fmt(distance,2)+' m'],['Lys',lux===null?'—':fmt(lux)+' lx']])}<p class="hint" style="margin-top:13px">Person og radar skal være i ro. Stilleståen og sensorens målekvalitet kan ikke bekræftes af appen.</p></div></article>`;
    }
    const fall = this._connected ? binaryState(s('fall')) : null;
    const kind = fall===true?'bad':fall===false?'good':'muted';
    return `<article class="device">${header}<div class="sensor-body"><div class="fall-visual ${kind}"><div class="ring">${icon('shield')}</div><strong>${fall===true?'Muligt fald registreret':fall===false?'Intet fald registreret':'Faldstatus er ukendt'}</strong><div class="hint">${fall===true?'Kontrollér personen og omgivelserne':fall===false?'Sensorens aktuelle registrering':'Kontrollér forbindelse og valg af entitet'}</div></div><div class="status ${kind}"><i class="dot"></i>${fall===true?'Faldsignalet er aktivt':fall===false?'Faldsignalet er inaktivt':'Intet tilgængeligt faldsignal'}</div>${details([['Tilstedeværelse',presenceLabel],['Lys',lux===null?'—':fmt(lux)+' lx'],['Status ændret',this._connected&&s('fall')?time(s('fall').last_changed):'—']])}<p class="hint" style="margin-top:13px">Ingen alarmudsendelse fra dette kort. Notifikationer skal opsættes i Home Assistant.</p></div></article>`;
  }
  _chart() {
    if (this._historyState==='loading') return '<div class="chart-empty" role="status">Henter historik fra Home Assistant…</div>';
    if (this._historyState==='error') return `<div class="error" role="status">${this._historyError}</div>`;
    const series = this._config.devices.filter(d=>d.model==='MR60BHA2' && d.id===(this._chartDevice || this._config.devices.find(x=>x.model==='MR60BHA2')?.id)).flatMap(d=>['heart_rate','breath_rate'].map(role=>({label:`${d.name} · ${ROLES[d.model][role]}`,role,rows:this._history[d.entities[role]] || []})));
    if (!series.some(s=>s.rows.some(r=>numberState(r)!==null))) return '<div class="chart-empty">Ingen målinger i den valgte periode. Historik kræver Home Assistant Recorder.</div>';
    const start=this._historyStart || Date.now()-this._hours*3600000, end=this._historyEnd || Date.now();
    const max=series.reduce((maximum,s)=>s.rows.reduce((m,r)=>Math.max(m,numberState(r) || 0),maximum),30);
    const paths = series.map((s,index)=>{
      let pen=false;
      const p=s.rows.map(r=>{
        const n=numberState(r);
        if(n===null || n<=0) {pen=false;return '';}
        const x=40+Math.max(0,Math.min(1,(r.at-start)/(end-start)))*720, y=134-(n/max)*115;
        const cmd=pen?'L':'M';pen=true;return `${cmd}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      return `<path d="${p}" stroke="${index%2?'#c49381':'#ad586d'}" fill="none" stroke-width="1.8" ${s.role==='breath_rate'?'stroke-dasharray="4 3"':''}/>`;
    }).join('');
    return `<div class="chart"><svg viewBox="0 0 780 165" role="img" aria-label="Rå historik fra Home Assistant for puls og vejrtrækning. Målekvalitet er ikke valideret.">${[0,.5,1].map(f=>`<line x1="40" y1="${134-f*115}" x2="760" y2="${134-f*115}" stroke="#f1e5e9"/><text x="24" y="${138-f*115}" text-anchor="end" fill="#ad959e" font-size="10">${fmt(max*f)}</text>`).join('')}${paths}<text x="40" y="158" font-size="10" fill="#ad959e">${time(start)}</text><text x="760" y="158" text-anchor="end" font-size="10" fill="#ad959e">${time(end)}</text></svg></div><div class="legend"><span>Puls · slag/min</span><span>Vejrtrækning · åndedrag/min</span></div><p class="hint">Rå registrerede værdier for den valgte BHA2-enhed. Målebetingelser er ikke valideret i historikken. Nuller og ukendte værdier bryder kurven.</p>`;
  }
  _historyPanel() {
    const bha=this._config.devices.filter(d=>d.model==='MR60BHA2');
    if(!bha.some(d=>d.id===this._chartDevice))this._chartDevice=bha[0]?.id;
    return `<section class="panel"><div class="chart-head"><div><h2>Puls & vejrtrækning</h2><p>Historik fra Home Assistant Recorder</p></div><div class="toolbar">${bha.length?`<select data-chart-device="true" aria-label="Enhed i grafen">${bha.map(d=>`<option value="${escapeHTML(d.id)}" ${d.id===this._chartDevice?'selected':''}>${escapeHTML(d.name)}</option>`).join('')}</select>`:''}<select data-hours="true" aria-label="Historikperiode">${[1,6,12,24].map(n=>`<option value="${n}" ${this._hours===n?'selected':''}>Seneste ${n===1?'time':n+' timer'}</option>`).join('')}</select><button class="btn" data-action="history" ${!this._connected||this._historyState==='loading'?'disabled':''}>Opdatér</button></div></div>${this._chart()}</section>`;
  }
  _events() {
    const events = this._config.devices.filter(d=>d.entities.fall).flatMap(d=>(this._history[d.entities.fall] || []).filter(r=>r.state==='on').map(r=>({...r,name:d.name}))).sort((a,b)=>b.at-a.at);
    return `<section class="panel"><div class="section-head"><h2>Faldsignaler i perioden</h2><button class="btn" data-action="csv" ${this._historyState!=='ready'?'disabled':''}>Eksportér CSV</button></div>${events.length?events.map(e=>`<div class="history-row"><time>${time(e.at)}</time><span>${escapeHTML(e.name)}</span><span class="badge">Faldsignal aktivt</span></div>`).join(''):'<p class="note">Ingen aktive faldsignaler i den hentede historik. Manglende historik er ikke dokumentation for, at der ikke er sket et fald.</p>'}<p class="hint">Et signal ved periodens begyndelse kan være startet tidligere. Tiderne kommer fra Recorder og er ikke en komplet alarmlog.</p></section>`;
  }
  _settings() {
    const states=this._hass?.states || {};
    return `<div class="toolbar" style="margin-bottom:18px"><button class="btn primary" data-action="discover" ${!this._connected||this._discovering?'disabled':''}>${this._discovering?'Søger…':'Find Seeed-enheder'}</button><button class="btn" data-action="add" data-model="MR60BHA2">+ MR60BHA2</button><button class="btn" data-action="add" data-model="MR60FDA2">+ MR60FDA2</button><button class="btn" data-action="yaml">Hent kortkonfiguration</button></div>${this._error?`<div class="error" role="status">${escapeHTML(this._error)}</div>`:''}<p class="note">Kontrollér alle forslag. Vælg de entiteter, der hører til den enkelte radar. Navne alene garanterer ikke korrekt kobling.</p><div class="device-list">${this._config.devices.map(d=>`<section class="settings-device"><div class="toolbar"><h2>${escapeHTML(d.model)}</h2><button class="btn" data-action="remove" data-id="${escapeHTML(d.id)}">Fjern fra visningen</button></div><div class="fields"><label class="field">Navn<input data-device="${escapeHTML(d.id)}" data-key="name" value="${escapeHTML(d.name)}" maxlength="100"></label><label class="field">Område<input data-device="${escapeHTML(d.id)}" data-key="area" value="${escapeHTML(d.area)}" maxlength="100"></label>${Object.entries(ROLES[d.model]).map(([role,label])=>{
      const domain=['presence','fall'].includes(role)?'binary_sensor.':'sensor.';
      const current=d.entities[role];
      const ids=Object.keys(states).filter(id=>id.startsWith(domain)); if(current&&!ids.includes(current))ids.push(current);ids.sort();
      return `<label class="field">${label}<select data-device="${escapeHTML(d.id)}" data-key="${role}" data-entity="true"><option value="">Ikke valgt</option>${ids.map(id=>`<option value="${escapeHTML(id)}" ${id===current?'selected':''}>${escapeHTML(states[id]?.attributes?.friendly_name || id)} — ${escapeHTML(id)}</option>`).join('')}</select></label>`;
    }).join('')}</div></section>`).join('')}</div>${this._editorMode?'':'<p class="note">I den selvstændige webapp gemmes koblinger lokalt i browseren. I Home Assistant skal ændringer gemmes via korteditoren; valg her er kun midlertidige.</p>'}`;
  }
  render() {
    if (!this.shadowRoot) return;
    const devices=this._config.devices;
    const states=this._hass?.states || {};
    const activeFalls=this._connected?devices.filter(d=>binaryState(states[d.entities.fall])===true):[];
    const present=this._connected?devices.filter(d=>binaryState(states[d.entities.presence])===true).length:0;
    const mapped=devices.filter(d=>Object.values(d.entities).some(Boolean)).length;
    if(this._editorMode) {this.shadowRoot.innerHTML=`<style>${css}</style><div>${this._settings()}</div>`;return;}
    this.shadowRoot.innerHTML=`<style>${css}</style><ha-card><div class="shell"><aside class="side"><div class="brand">${icon('pulse')}<span>ESP32<span>Health</span></span></div><div class="caption">Dit overblik</div>${[['overview','grid','Overblik'],['history','history','Historik'],['devices','settings','Enheder']].map(([id,i,label])=>`<button class="nav ${this._tab===id?'active':''}" data-action="tab" data-tab="${id}" aria-label="${label}" aria-pressed="${this._tab===id}">${icon(i)}<span>${label}</span></button>`).join('')}<div class="side-foot"><strong>Lokalt. Kontaktløst. Dit.</strong>ESPHome → Home Assistant<br>ESP32Health ${VERSION}</div></aside><main class="body"><div class="topbar"><div class="breadcrumb">Dit hjem <span aria-hidden="true">/</span> <b>${this._tab==='overview'?'Overblik':this._tab==='history'?'Historik':'Enheder'}</b></div><span class="pill ${this._connected?'':'muted'}"><i class="dot"></i>${this._hass?.demo?'Demoforbindelse':this._connected?'Home Assistant tilsluttet':'Home Assistant afbrudt'}</span></div>${this._hass?.demo?'<div class="demo" role="status"><b>Demotilstand</b> · Alle værdier og enheder er syntetiske eksempler. Ingen rigtige sensorer er tilsluttet.</div>':''}<div class="heading"><div><div class="caption">ESP32Health</div><h1>${escapeHTML(this._tab==='overview'?(this._config.title || 'Dit hjem, i overblik'):this._tab==='history'?'Se tilbage på målingerne':'Dine enheder')}</h1><p class="sub">${this._tab==='overview'?'Kontaktløs registrering af puls, vejrtrækning og mulige fald.':this._tab==='history'?'Se registrerede sensorværdier og hent dem som CSV.':'Forbind dine Seeed-radarer med de rigtige sensordata.'}</p></div>${this._tab==='overview'?`<button class="btn" data-action="tab" data-tab="devices">${icon('settings')}Enheder</button>`:''}</div>${!this._connected&&devices.length?'<div class="alert" role="status">Liveforbindelsen er afbrudt. Aktuel puls, vejrtrækning og faldstatus kan ikke vises.</div>':''}${activeFalls.map(d=>`<div class="alert" role="alert">${icon('shield')}<div><b>Muligt fald · ${escapeHTML(d.name)}</b><br>Kontrollér personen og omgivelserne. Sensorens faldsignal er aktivt.</div></div>`).join('')}${this._tab==='devices'?this._settings():!devices.length?`<div class="panel empty">${icon('radar')}<h2>Giv dine sensorer en plads</h2><p class="sub">Tilføj en MR60BHA2 til puls og vejrtrækning<br>eller en MR60FDA2 til faldregistrering.</p><button class="btn primary" data-action="tab" data-tab="devices">Opsæt enheder ${icon('arrow')}</button></div>`:this._tab==='history'?this._historyPanel()+this._events():`<div class="summary"><div class="stat"><small>Enheder i overblikket</small><strong>${devices.length.toString().padStart(2,'0')}</strong><em>${mapped} med valgte entiteter</em></div><div class="stat"><small>Radarer med tilstedeværelse</small><strong>${this._connected?present.toString().padStart(2,'0'):'—'}</strong><em>Dette er ikke et persontal</em></div><div class="stat"><small>Aktive faldsignaler</small><strong>${this._connected?activeFalls.length.toString().padStart(2,'0'):'—'}</strong><em>Kun tilgængelige signaler</em></div><div class="stat"><small>Datakilde</small><strong style="font-size:17px;margin-top:13px">${this._hass?.demo?'Demo':'Home Assistant'}</strong><em>Ingen ekstra datasky</em></div></div><div class="section-head"><h2>Rum & sensorer</h2><span>${devices.length} enheder</span></div><div class="devices">${devices.map(d=>this._device(d)).join('')}</div>${this._historyPanel()}`}<footer class="bottom"><span>Sensorestimater · Ikke medicinsk udstyr eller et alarmsystem</span><span>Historik opdateres med knappen Opdatér</span></footer></main></div></ha-card>`;
  }
}
export class ESP32HealthEditor extends HTMLElement {
  constructor() {
    super(); this._card=new ESP32HealthCard(); this._card._editorMode=true; this.attachShadow({mode:'open'}).append(this._card);
    this._card.addEventListener('esp32health-config-changed',e=>{
      e.stopPropagation(); this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:e.detail.config},bubbles:true,composed:true}));
    });
  }
  setConfig(config) { this._card.setConfig(config); }
  set hass(hass) { this._card.hass=hass; }
}
if(!customElements.get('esp32health-card'))customElements.define('esp32health-card',ESP32HealthCard);
if(!customElements.get('esp32health-editor'))customElements.define('esp32health-editor',ESP32HealthEditor);
if (typeof window !== 'undefined') {
  window.customCards=window.customCards || [];
  if(!window.customCards.some(c=>c.type==='esp32health-card'))window.customCards.push({type:'esp32health-card',name:'ESP32Health',description:'MR60BHA2 puls og vejrtrækning · MR60FDA2 faldregistrering',preview:false});
}
