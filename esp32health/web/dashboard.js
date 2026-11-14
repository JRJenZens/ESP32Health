/* ESPHealth v0.5.0 | MIT | https://github.com/JRJenZens/ESP32Health */
export const VERSION = '0.5.0';
export const THRESHOLD_RULES=['heart_low','heart_high','breath_low','breath_high'];
export const DEFAULT_ALERTS = {enabled:false,heart_low:null,heart_high:null,breath_low:null,breath_high:null,signal_loss:false,fall:false,delay:30,notify_service:'persistent_notification.create',notification_level:'normal',threshold_version:2,critical_heart_low:null,critical_heart_high:null,critical_breath_low:null,critical_breath_high:null};
export function normalizeAlerts(value={}) {
  const a={...DEFAULT_ALERTS,...value};
  const legacy=!Object.hasOwn(value,'threshold_version')&&!Object.keys(value).some(k=>k.startsWith('critical_')||k.endsWith('_delay'));
  for(const rule of THRESHOLD_RULES){
    a[rule+'_delay']=Object.hasOwn(value,rule+'_delay')?value[rule+'_delay']:a.delay;
    a['critical_'+rule+'_delay']=Object.hasOwn(value,'critical_'+rule+'_delay')?value['critical_'+rule+'_delay']:a.delay;
    if(legacy&&a.notification_level==='critical'){a['critical_'+rule]=a[rule];a[rule]=null;}
  }
  a.threshold_version=2;return a;
}
export function validateAlerts(a,model) {
  const rules=THRESHOLD_RULES.flatMap(k=>[k,'critical_'+k]);
  for(const key of ['delay',...rules.map(k=>k+'_delay')])if(!Number.isInteger(a[key])||a[key]<1||a[key]>3600)throw Error('Vælg en varighed på 1–3600 hele sekunder.');
  for(const rule of rules){const n=a[rule],max=rule.includes('heart')?300:100;if(n!==null&&(!Number.isFinite(n)||n<=0||n>max))throw Error('Angiv positive grænser inden for feltets interval, eller lad feltet stå tomt.');if(model!=='MR60BHA2'&&n!==null)throw Error('Puls- og vejrtrækningsgrænser kræver MR60BHA2.');}
  for(const metric of ['heart','breath']){
    const lows=[a[metric+'_low'],a['critical_'+metric+'_low']].filter(n=>n!==null),highs=[a[metric+'_high'],a['critical_'+metric+'_high']].filter(n=>n!==null);
    if(lows.length&&highs.length&&Math.max(...lows)>=Math.min(...highs))throw Error('Den nedre grænse skal være lavere end den øvre.');
  }
  for(const rule of THRESHOLD_RULES)if(a[rule]!==null&&a['critical_'+rule]!==null&&(rule.endsWith('low')?a['critical_'+rule]>a[rule]:a['critical_'+rule]<a[rule]))throw Error('Den kritiske grænse skal ligge mindst lige så langt uden for normalområdet som alarmgrænsen.');
  if(a.enabled&&!a.signal_loss&&!a.fall&&rules.every(k=>a[k]===null))throw Error('Vælg mindst én regel, før du slår alarmer til.');
  if((a.notification_level==='critical'||THRESHOLD_RULES.some(k=>a['critical_'+k]!==null))&&a.notify_service==='persistent_notification.create')throw Error('Vælg en telefon eller tablet som modtager af en kritisk besked.');
  return a;
}
export const ROLES = {
  MR60BHA2: { presence: 'Tilstedeværelse', heart_rate: 'Puls', breath_rate: 'Vejrtrækning', distance: 'Afstand', num_targets: 'Antal personer (estimat)', illuminance: 'Lysniveau' },
  MR60FDA2: { presence: 'Tilstedeværelse', fall: 'Fald registreret', illuminance: 'Lysniveau' },
};
export const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, digits = 0) => Number.isFinite(n) ? new Intl.NumberFormat('da-DK', { maximumFractionDigits: digits }).format(n) : '—';
const time = (v) => new Date(v).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
export const connectionOnline = hass => Boolean(hass?.connected);
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
  const blocked = (label,kind='warn') => ({kind,label,usable:false,heart_usable:false,breath_usable:false});
  if (!connected) return blocked('Forbindelsen er afbrudt','muted');
  if (binaryState(s('presence')) === false) return blocked('Ingen person registreret','muted');
  if (binaryState(s('presence')) !== true) return blocked('Tilstedeværelse er ukendt');
  if (numberState(s('num_targets')) !== 1) return blocked(numberState(s('num_targets')) > 1 ? 'Flere personer · usikker måling' : 'Antal personer er ikke bekræftet');
  const distance = distanceMetres(s('distance'));
  if (distance === null) return blocked('Afstand eller måleenhed er ukendt');
  if (distance < .5 || distance > 1.5) return blocked('Uden for målezonen på 0,5–1,5 m');
  if (['num_targets', 'distance'].some(k => readingAge(s(k), now) > staleAfter)) return blocked('Afstand eller personantal er for gammelt');
  const heart_usable=numberState(s('heart_rate'))>0 && readingAge(s('heart_rate'),now)<=staleAfter;
  const breath_usable=numberState(s('breath_rate'))>0 && readingAge(s('breath_rate'),now)<=staleAfter;
  return {kind:heart_usable&&breath_usable?'good':'warn',label:heart_usable&&breath_usable?'Én person i målezonen':heart_usable?'Puls modtaget · afventer vejrtrækningssignal':breath_usable?'Vejrtrækning modtaget · afventer pulssignal':'Afventer brugbar puls og vejrtrækning',usable:heart_usable&&breath_usable,heart_usable,breath_usable};
}
const rolePatterns = {
  presence: /has_target|people_exist|person_information|presence|tilstede|person information/i,
  heart_rate: /heart.?rate|heartbeat|puls/i,
  breath_rate: /breath.?rate|respiratory|respiration|vejrtr/i,
  distance: /distance|afstand/i,
  num_targets: /num.?targets|target.?number|target.?count|antal.?personer|personantal/i,
  fall: /fall|fald/i,
  illuminance: /illuminance|illumin|lux|lysni|belysning/i,
};
function roleMatches(entry, role, states) {
  if (entry.disabled_by || !entry.entity_id?.startsWith(['presence','fall'].includes(role)?'binary_sensor.':'sensor.')) return false;
  const label=`${entry.entity_id} ${entry.original_name || ''} ${entry.name || ''} ${entry.translation_key || ''} ${states[entry.entity_id]?.attributes?.friendly_name || ''}`;
  return rolePatterns[role].test(label) || (role==='illuminance' && states[entry.entity_id]?.attributes?.unit_of_measurement==='lx');
}
export function mapDevice(device, model, entities, areas=[], states={}) {
  const mapped={};
  for(const role of Object.keys(ROLES[model])) {
    const candidates=entities.filter(e=>e.device_id===device.id && roleMatches(e,role,states));
    // Leave ambiguous names for review instead of choosing arbitrarily.
    if(candidates.length===1)mapped[role]=candidates[0].entity_id;
  }
  return {id:device.id,model,name:device.name_by_user || device.name || model,area:areas.find(a=>a.area_id===device.area_id)?.name || '',entities:mapped};
}
export function inferModel(device, entities, states={}) {
  const explicit=`${device.model || ''} ${device.name || ''} ${device.name_by_user || ''}`.match(/MR60(?:FDA2|BHA2)/i)?.[0]?.toUpperCase();
  if(explicit)return explicit;
  const own=entities.filter(e=>e.device_id===device.id && e.platform==='esphome');
  if(!own.length)return '';
  const bha=mapDevice(device,'MR60BHA2',own,[],states).entities;
  const fda=mapDevice(device,'MR60FDA2',own,[],states).entities;
  const hasBHA=Boolean(bha.heart_rate && bha.breath_rate && (bha.presence || bha.distance));
  const hasFDA=Boolean(fda.fall && fda.presence);
  return hasBHA===hasFDA?'':hasBHA?'MR60BHA2':'MR60FDA2';
}
export function espHomeDevices(devices, entities, areas=[], states={}) {
  const ids=new Set(entities.filter(e=>e.platform==='esphome').map(e=>e.device_id));
  return devices.filter(d=>ids.has(d.id)).map(d=>({...d,display_name:d.name_by_user || d.name || d.id,area:areas.find(a=>a.area_id===d.area_id)?.name || '',inferred_model:inferModel(d,entities,states)})).sort((a,b)=>a.display_name.localeCompare(b.display_name,'da'));
}
export function discoverDevices(devices, entities, areas=[], states={}) {
  return devices.flatMap(d=>{const model=inferModel(d,entities,states);return model?[mapDevice(d,model,entities,areas,states)]:[];});
}
export function mergeDevice(config, suggested, entities) {
  const sourceIds=new Set(entities.filter(e=>e.device_id===suggested.id).map(e=>e.entity_id));
  let index=config.devices.findIndex(d=>d.id===suggested.id || Object.values(d.entities).some(id=>id && sourceIds.has(id)));
  if(index<0)index=config.devices.findIndex(d=>d.model===suggested.model && !Object.values(d.entities).some(Boolean));
  const devices=config.devices.slice();
  if(index<0)devices.push(suggested);
  else {
    const old=devices[index];
    const mapped={...suggested.entities};
    if(old.model===suggested.model)for(const [role,id]of Object.entries(old.entities))if(id)mapped[role]=id;
    devices[index]={...suggested,id:old.id,name:Object.values(old.entities).some(Boolean)?old.name:suggested.name,area:old.area || suggested.area,entities:mapped};
  }
  return {...config,devices};
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
 heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
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
:host{display:block;container-type:inline-size;color:#493238;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--green:#9d495d;--muted:#927b80;--line:#eee2e5;--bg:#fcf7f7;--ink:#4c3039}*{box-sizing:border-box}button,select,input{font:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.5}button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #cc98a8;outline-offset:3px}button svg{width:18px;height:18px}svg{width:24px;height:24px;flex-shrink:0}ha-card{display:block;overflow:hidden;background:var(--bg);border:1px solid var(--line);border-radius:20px;color:var(--ink)}.shell{display:grid;grid-template-columns:208px 1fr;min-height:740px}.side{padding:30px 20px;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:8px}.brand{display:flex;align-items:center;gap:9px;font-size:18px;font-weight:750;letter-spacing:-.8px;margin-bottom:35px}.brand svg{color:var(--green);width:30px;height:30px}.brand span span{font-weight:400}.caption{font-size:10px;letter-spacing:1.7px;color:var(--muted);font-weight:650;text-transform:uppercase}.nav{display:flex;align-items:center;gap:12px;border:0;background:none;text-align:left;border-radius:10px;color:#927b80;padding:12px;margin:3px 0}.nav.active{color:#97485b;background:#f8e9ed;font-weight:650}.side-foot{margin-top:auto;padding-top:48px;color:var(--muted);font-size:11px}.side-foot strong{display:block;color:#65464f;margin-bottom:6px}.body{padding:28px 34px 24px;min-width:0}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:34px}.breadcrumb{font-size:12px;color:var(--muted)}.breadcrumb b{color:#62414b;font-weight:500}.pill{border:1px solid #ead8df;border-radius:30px;background:#fff;font-size:11px;padding:6px 11px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.dot{height:6px;width:6px;border-radius:100%;background:#4b9d7c;display:inline-block}.muted .dot{background:#aa959b}.warn .dot{background:#bb8a34}.bad .dot{background:#b94444}h1{font-size:29px;letter-spacing:-1px;font-weight:600;line-height:1.2;margin:7px 0 10px}h2{font-size:16px;font-weight:650;letter-spacing:-.3px;margin:0}h3{font-size:13px;margin:0;font-weight:650}p{margin:6px 0}.sub{color:var(--muted);font-size:13px}.heading{display:flex;justify-content:space-between;align-items:end;gap:12px;margin-bottom:25px}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid #eadbdf;border-radius:8px;padding:8px 12px;background:#fff;color:#744b59;font-size:12px;text-decoration:none}.btn.primary{background:#a14e63;border-color:#a14e63;color:#fff}.demo{background:#fff4df;color:#80601d;border:1px solid #ebd7ab;padding:10px 14px;border-radius:10px;font-size:12px;margin-bottom:22px}.alert{padding:14px 17px;border-radius:12px;margin-bottom:18px;border:1px solid #e6b5b5;background:#fff1ef;color:#933d35;display:flex;gap:12px;align-items:center}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0 27px}.stat{padding:16px 18px;background:#fff;border:1px solid var(--line);border-radius:12px}.stat small{color:var(--muted);font-size:11px}.stat strong{font-size:23px;font-weight:600;display:block;letter-spacing:-.5px;margin:6px 0 2px}.stat em{font-style:normal;font-size:11px;color:var(--muted)}.section-head{display:flex;justify-content:space-between;align-items:center;margin:6px 0 14px}.section-head span{font-size:11px;color:var(--muted)}.devices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.device{background:#fff;border:1px solid var(--line);border-radius:15px;overflow:hidden}.device-header{display:flex;align-items:center;gap:10px;padding:19px 20px 15px}.device-icon{height:40px;width:40px;border-radius:11px;background:#faedf0;display:grid;place-items:center;color:#a76276}.device-header .text{flex:1;min-width:0}.device-header h2{font-size:14px}.model{font-size:10px;color:var(--muted);margin-top:2px}.sensor-body{padding:0 20px 18px}.measurements{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:18px 0}.metric-label{display:flex;align-items:center;gap:6px;font-size:11px;color:#977b85}.metric-label svg{height:16px;width:16px}.number{font-size:39px;font-weight:500;letter-spacing:-1.5px;line-height:1.4}.number span{font-size:11px;color:var(--muted);letter-spacing:0;margin-left:5px;font-weight:400}.hint{font-size:10px;color:var(--muted)}.status{padding:8px 10px;border-radius:7px;background:#eef5f0;color:#3a7356;font-size:10px;display:flex;gap:7px;align-items:center}.status.warn{background:#faf4e8;color:#8b6b2d}.status.muted{background:#f0f2f0;color:#748078}.status.bad{background:#fff0ed;color:#a1483d}.detail-row{display:flex;gap:12px;justify-content:space-between;border-top:1px solid var(--line);padding-top:13px;margin-top:14px;color:#a08b92;font-size:11px}.detail-row b{display:block;font-size:12px;font-weight:550;color:#72505b;margin-top:3px}.fall-visual{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:19px 0 17px;min-height:133px}.fall-visual .ring{width:56px;height:56px;border:1px solid #e3cdd5;box-shadow:0 0 0 9px #fcf4f6;border-radius:50%;display:grid;place-items:center;color:#5b8f6e;margin:0 0 16px}.fall-visual.bad .ring{color:#ad433c;background:#fff0ed;box-shadow:0 0 0 9px #fff6f4;border-color:#f1cbc5}.fall-visual strong{font-size:15px;font-weight:550}.panel{margin-top:22px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px}.chart-head{display:flex;justify-content:space-between;gap:15px;align-items:center}.chart-head p{font-size:11px;color:var(--muted)}select,input{background:#fff;border:1px solid #eadbdf;border-radius:7px;color:#744b59;padding:8px;max-width:100%;min-width:0}.chart{margin-top:15px}.chart svg{width:100%;height:160px;overflow:visible}.legend{display:flex;gap:16px;font-size:10px;color:#977b85;flex-wrap:wrap}.legend span::before{content:'';display:inline-block;width:7px;height:7px;background:#ad586d;border-radius:50%;margin-right:5px}.legend span:last-child::before{background:#c49381}.chart-empty{text-align:center;padding:30px;color:var(--muted);font-size:12px;border:1px dashed var(--line);border-radius:8px;margin-top:15px}.bottom{display:flex;justify-content:space-between;gap:15px;color:#a48e97;font-size:10px;padding-top:20px}.note{font-size:11px;color:#927b80;line-height:1.6}.badge{font-size:10px;background:#faeef2;color:#977580;border-radius:5px;padding:3px 6px}.empty{text-align:center;padding:50px 20px}.empty svg{width:42px;height:42px;color:var(--green)}.empty h2{margin:15px 0 8px}.empty .btn{margin-top:15px}.device-list{display:grid;gap:14px}.settings-device,.picker-panel{border:1px solid var(--line);padding:16px;border-radius:12px}.picker-panel{margin-bottom:18px;background:#fff}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#947581}.field select,.field input{width:100%;font-size:12px}.settings-device .toolbar{justify-content:space-between;margin-bottom:16px}.error{padding:11px;background:#fff0ed;border-radius:7px;color:#a1483d;font-size:12px;margin:12px 0}.history-row{display:grid;grid-template-columns:100px 1fr auto;gap:12px;border-top:1px solid var(--line);padding:12px 0;font-size:12px}.history-row time{color:var(--muted)}.pending{padding:30px;text-align:center;color:var(--muted)}.wrap-name{overflow-wrap:anywhere}
@media(min-width:1250px){.body{padding:32px 44px}.number{font-size:43px}.sensor-body{padding:0 24px 22px}}
@container(max-width:900px){.shell{grid-template-columns:1fr}.side{padding:14px 22px;flex-direction:row;align-items:center;border-right:0;border-bottom:1px solid var(--line);gap:8px}.brand{margin:0 auto 0 0;font-size:16px}.brand svg{width:25px}.side .caption,.side-foot{display:none}.nav{padding:9px}.nav span{display:none}.body{padding:22px}.topbar{margin-bottom:24px}.shell{min-height:0}}
@container(max-width:760px){.devices{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr);gap:8px}.stat{padding:12px}.body{padding:18px 14px}.side{padding:13px 14px}.heading{align-items:start;flex-direction:column}h1{font-size:26px}.fields{grid-template-columns:1fr}.chart-head{align-items:start;flex-direction:column}.bottom{flex-direction:column}.device-header{padding:16px}.sensor-body{padding:0 16px 16px}.pill{font-size:10px}.history-row{grid-template-columns:70px 1fr auto}}
@media(prefers-reduced-motion:no-preference){.dot{transition:background .2s}}
`;

const monitorCSS = `
.indicator-panel{border-top:1px solid var(--line);margin-top:18px;padding-top:16px}.led-legend{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;color:#805866;margin:12px 0}.alarm-intro .note{margin:0 0 8px}@container(max-width:600px){.led-legend{grid-template-columns:1fr}}

.threshold-groups{display:grid;gap:18px}.threshold-group{border:1px solid var(--line);border-radius:10px;overflow:hidden}.threshold-group>h3{padding:12px 14px;background:#fcf4f6}.threshold-head,.threshold-row{display:grid;grid-template-columns:130px 1fr 1fr;gap:12px;padding:12px 14px}.threshold-head{font-size:11px;color:#805866;background:#fff9fa}.threshold-row{border-top:1px solid var(--line);align-items:center}.threshold-row>b{font-size:12px}.threshold-row small{display:block;font-size:10px;font-weight:400;color:var(--muted);margin-top:3px}.threshold-level{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:0}.critical-level{border-left:2px solid #d796a8;padding-left:12px}.threshold-level .field{font-size:10px}.threshold-head span:last-child{color:#a03451}
@container(max-width:1050px){.threshold-head,.threshold-row{grid-template-columns:100px 1fr 1fr;gap:10px}.threshold-level{grid-template-columns:1fr}}
@container(max-width:600px){.threshold-head{display:none}.threshold-row{grid-template-columns:1fr;gap:12px}.threshold-level{grid-template-columns:1fr 1fr}.threshold-row>b{font-size:13px}.threshold-level:first-of-type::before{content:'Alarm · almindelig besked';grid-column:1/-1;font-size:11px;color:#805866}.critical-level::before{content:'Kritisk alarm · kritisk besked';grid-column:1/-1;font-size:11px;color:#a03451}.critical-level{padding:10px 0 0;border-left:0;border-top:1px solid #ecc6d1}}

.vital-monitor{background:#23181e;color:#f8e8ee;border:1px solid #452733;border-radius:12px;padding:18px;display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:5px 0 14px;overflow:hidden}.monitor-channel{min-width:0}.monitor-channel+.monitor-channel{border-left:1px solid #50313d;padding-left:14px}.monitor-label{font-size:12px;font-weight:600;color:#ffd5de}.monitor-label span{display:block;font-size:9px;color:#b69ba7;font-weight:400;margin-top:2px}.monitor-reading{font-size:48px;font-variant-numeric:tabular-nums;line-height:1.4;letter-spacing:-1px;color:#ffb1c1}.monitor-reading small{display:block;font-size:10px;color:#c1a4ae;letter-spacing:0;margin-top:-5px}.monitor-channel:last-of-type .monitor-reading{color:#dcc3ff}.rhythm{height:44px;display:flex;align-items:center;gap:12px;color:#6d4a58;margin:8px 0 3px}.rhythm svg{width:30px;height:30px}.rhythm-line{height:2px;flex:1;background:currentColor;border-radius:2px;opacity:.3}.rhythm.running{color:#ff8fa8}.rhythm.running svg{animation:heartbeat var(--period) ease-in-out infinite;transform-origin:center}.rhythm.breath_rate.running{color:#c7a6f6}.rhythm.breath_rate.running svg{animation:breathe var(--period) ease-in-out infinite}.monitor-state{font-size:9px;color:#b99da9}.monitor-caption{grid-column:1/-1;font-size:9px;color:#c8aebb;border-top:1px solid #50313d;padding-top:10px;margin:0}.diagnostics{margin-top:14px;border-top:1px solid var(--line);padding-top:11px;font-size:11px;color:#927b80}.diagnostics summary{cursor:pointer;color:#825263;font-weight:600}.diagnostics p{overflow-wrap:anywhere;margin:9px 0}.raw-values{display:flex;gap:25px}.raw-values b{display:block;color:#603f4b}.check{display:flex;align-items:flex-start;gap:9px;font-size:12px;color:#6b4553;margin:16px 0}.check input{width:17px;height:17px;accent-color:#a14e63;flex-shrink:0}.alarm-settings{background:#fff}.alarm-rule{display:flex;flex-direction:column;gap:3px;padding:12px 0;border-bottom:1px solid var(--line);font-size:11px}.alarm-rule span{color:#927b80}.alarm-rule.bad b,.delivery-error{color:#a23944!important}.alarm-settings .note{margin:12px 0}.alarm-settings .btn:disabled{cursor:wait}
@keyframes heartbeat{0%,40%,100%{transform:scale(1);opacity:.7}12%{transform:scale(1.2);opacity:1}25%{transform:scale(1.03)}30%{transform:scale(1.13)}}@keyframes breathe{0%,100%{transform:scale(.78);opacity:.6}50%{transform:scale(1.14);opacity:1}}
@media(prefers-reduced-motion:reduce){.rhythm.running svg{animation:none}}
@container(max-width:480px){.vital-monitor{padding:13px;gap:10px}.monitor-channel+.monitor-channel{padding-left:10px}.monitor-reading{font-size:42px}.monitor-caption{font-size:9px}.nav{gap:5px;padding:8px}.nav span{font-size:10px}.side{gap:1px;padding:12px}.brand{font-size:13px;gap:4px}.brand svg{width:20px}}
`;
export class ESP32HealthDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._config = {devices:[]};
    this._tab = 'overview'; this._history = {}; this._hours = 6; this._historyState = 'idle';
    this._signature = ''; this._error = ''; this._historyRequest = 0;
    this._registries={devices:[],entities:[],areas:[]}; this._registryLoaded=false; this._registryPromise=null;
    this._pickerOpen=false; this._pickerDevice=''; this._pickerModel='';
    this._targets=[{id:'persistent_notification.create',name:'Home Assistant · Notifikationer'}];
    this._alertDrafts={};this._alarmError='';this._targetsLoaded=false;
    this._diagnosticOpen=new Set();
    this._testMessages={};this._testingId='';this._testCooldownUntil=0;
    this._indicatorDrafts={};this._indicatorErrors={};
    this.shadowRoot.addEventListener('click', e => this._click(e));
    this.shadowRoot.addEventListener('change', e => this._change(e));
    this.shadowRoot.addEventListener('input', e => {if(e.target.dataset.alertKey||e.target.dataset.indicatorKey)this._change(e);});
    this.shadowRoot.addEventListener('toggle',e=>{const id=e.target.dataset.diagnostics;if(id){if(e.target.open)this._diagnosticOpen.add(id);else this._diagnosticOpen.delete(id);}},true);
  }
  setConfig(config) {
    validateConfig(config);
    this._config = JSON.parse(JSON.stringify(config));
    this._historyRequest++; this._history = {}; this._historyState = 'idle'; this._signature = '';
    this.render();
  }
  set hass(hass) {
    this._hass = hass;
    this._refreshIndicatorStatus();
    const signature = this._tab==='devices' ? JSON.stringify([this._connected,Object.entries(hass.states || {}).map(([id,s])=>[id,s.attributes?.friendly_name]),this._config.devices.map(d=>hass.states?.[d.entities.fall]?.state)]) : JSON.stringify([this._connected, this._config.devices.map(d => [Object.values(d.entities).map(id => [hass.states?.[id]?.state,hass.states?.[id]?.attributes?.unit_of_measurement]),d.model==='MR60BHA2'?evaluateBHA(d,hass.states || {},this._connected,Date.now(),this._config.stale_after || 180):hass.states?.[d.entities.fall]?.last_changed]),hass.alerts]);
    if (signature !== this._signature) { this._signature = signature; if(this._tab==='alerts')this._refreshAlarmStatus();else this.render(); }
    if (!hass.configSaving && this._historyState === 'idle' && this.isConnected && this._connected && this._config.devices.length) void this.loadHistory();
  }
  connectedCallback() {
    this._timer = setInterval(() => { if(!['devices','alerts'].includes(this._tab))this.render(); }, 15000);
    this._alarmTimer=setInterval(()=>{if(this._tab==='alerts')this._refreshAlarmStatus();},1000);
    this.render();
    if (this._hass && this._historyState === 'idle' && this._config.devices.length) void this.loadHistory();
  }
  disconnectedCallback() { clearInterval(this._timer);clearInterval(this._alarmTimer);clearTimeout(this._testCooldownTimer);this._historyRequest++; if(this._historyState === 'loading') this._historyState = 'idle'; }
  get _connected() { return connectionOnline(this._hass); }
  async loadHistory() {
    const ids = [...new Set(this._config.devices.flatMap(d => Object.values(d.entities)).filter(Boolean))];
    if (!this._connected || this._hass.configSaving || !ids.length || !this._hass.callWS) return;
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
  async _loadRegistries() {
    if(this._registryPromise)return this._registryPromise;
    this._registryPromise=(async()=>{
      const [devices,entities,areas]=await Promise.all([
        this._hass.callWS({type:'config/device_registry/list'}),
        this._hass.callWS({type:'config/entity_registry/list'}),
        this._hass.callWS({type:'config/area_registry/list'}),
      ]);
      this._registries={devices,entities,areas};this._registryLoaded=true;
    })();
    try{await this._registryPromise;}finally{this._registryPromise=null;}
  }
  async _openPicker() {
    this._pickerOpen=true;this._error='';this._discovering=true;this.render();
    try{await this._loadRegistries();}
    catch(_){this._error='Enhedslisten kunne ikke hentes. Kontrollér forbindelsen til Home Assistant.';}
    this._discovering=false;this.render();
  }
  async _discover() {
    this._error='';this._discovering=true;this.render();
    try {
      await this._loadRegistries();
      const {devices,entities,areas}=this._registries;
      const found=discoverDevices(devices,entities,areas,this._hass.states);
      let config=this._config;
      for(const device of found)config=mergeDevice(config,device,entities);
      if(!found.length){this._pickerOpen=true;this._error='Ingen sikre radarmatch. Vælg en ESPHome-enhed og radarmodel nedenfor.';}
      else if(JSON.stringify(config)!==JSON.stringify(this._config))this._commit(config);
    }catch(_){this._error='Enhederne kunne ikke hentes fra Home Assistant. Kontrollér forbindelsen og prøv igen.';}
    this._discovering=false;this.render();
  }
  _addPickedDevice() {
    const {devices,entities,areas}=this._registries;
    const device=devices.find(d=>d.id===this._pickerDevice);
    if(!device || !Object.hasOwn(ROLES,this._pickerModel))return;
    const mapped=mapDevice(device,this._pickerModel,entities,areas,this._hass.states);
    this._commit(mergeDevice(this._config,mapped,entities));
    this._pickerOpen=false;this._error='';this.render();
  }
  _indicatorOptions(device) {
    const entries=this._registries.entities;
    const known=new Set(Object.values(device.entities).map(id=>entries.find(e=>e.entity_id===id)?.device_id).filter(Boolean));
    const source=this._registries.devices.some(d=>d.id===device.id)?device.id:known.size===1?[...known][0]:null;
    const ids=source?entries.filter(e=>e.platform==='esphome'&&!e.disabled_by&&e.device_id===source&&e.entity_id.startsWith('select.')&&(e.original_name==='ESPHealth LED status'||/_esphealth_led_status(?:_\d+)?$/.test(e.entity_id))).map(e=>e.entity_id):[];
    const current=device.indicator?.entity_id;if(current&&!ids.includes(current))ids.push(current);
    return ids.sort();
  }
  _indicatorPanel(d) {
    const a={enabled:false,entity_id:'',...d.indicator,...this._indicatorDrafts[d.id]};
    const options=this._indicatorOptions(d),states=this._hass?.states || {};
    return `<section class="indicator-panel"><h3>Status-LED</h3><label class="check"><input type="checkbox" data-device="${escapeHTML(d.id)}" data-indicator-key="enabled" ${a.enabled?'checked':''}>Brug radarens LED til ESPHealth-status</label><label class="field">ESPHealth LED status<select data-device="${escapeHTML(d.id)}" data-indicator-key="entity_id"><option value="">Vælg status-LED</option>${options.map(id=>`<option value="${escapeHTML(id)}" ${id===a.entity_id?'selected':''}>${escapeHTML(states[id]?.attributes?.friendly_name || id)}</option>`).join('')}</select></label><p class="note">${options.length?'Status-LED fra samme fysiske radar.':'Installér ESPHome-opsætningen til ESPHealth-status-LED på radaren for at få den med i listen.'}</p><div class="led-legend"><span>🟢 Svagt grøn: person registreret</span><span>🟡 Gult blink: almindelig alarm</span><span>🔴 Rødt blink: kritisk alarm</span><span>🔵 Blåt blink: ingen kontakt til HA/ESPHealth i 45 sekunder</span></div><p class="note">Uden en person er LED’en slukket. Grønt viser tilstedeværelse, ikke en vurdering af sundhed.</p><p class="note" role="status" data-indicator-status="${escapeHTML(d.id)}"></p>${this._indicatorErrors[d.id]?`<p class="error" role="alert">${escapeHTML(this._indicatorErrors[d.id])}</p>`:''}<button class="btn" data-action="save-indicator" data-id="${escapeHTML(d.id)}">Gem LED-indstillinger</button></section>`;
  }
  _saveIndicator(id) {
    const device=this._config.devices.find(x=>x.id===id);
    const a={enabled:false,entity_id:'',...device.indicator,...this._indicatorDrafts[id]};
    for(const el of this.shadowRoot.querySelectorAll('[data-indicator-key]'))if(el.dataset.device===id)a[el.dataset.indicatorKey]=el.type==='checkbox'?el.checked:el.value;
    this._indicatorErrors[id]=a.enabled&&!a.entity_id?'Vælg status-LED, før den aktiveres.':'';
    if(this._indicatorErrors[id]){this.render();return;}
    delete this._indicatorDrafts[id];this._commit({...this._config,devices:this._config.devices.map(d=>d.id===id?{...d,indicator:a}:d)});
  }
  _refreshIndicatorStatus() {
    const labels={Auto:'Automatisk tilstedeværelse',Advarsel:'Gult alarmblink',Kritisk:'Rødt kritisk blink',Slukket:'LED-styring slået fra'};
    for(const el of this.shadowRoot?.querySelectorAll('[data-indicator-status]') || []){
      const s=this._hass?.indicators?.devices?.[el.dataset.indicatorStatus];
      el.textContent=s?s.state==='ok'?labels[s.mode] || s.mode:s.state==='waiting'?'Afventer Home Assistant · LED’en viser blåt efter timeout':'LED kunne ikke opdateres · kontrollér forbindelse og ESPHome-opsætning':'LED er ikke konfigureret';
    }
    for(const b of this.shadowRoot?.querySelectorAll('[data-action="save-indicator"]') || [])b.disabled=Boolean(this._hass?.configSaving);
  }
  _entityOptions(device,role) {
    const states=this._hass?.states || {};
    const domain=['presence','fall'].includes(role)?'binary_sensor.':'sensor.';
    const entries=this._registries.entities;
    const knownIds=new Set(Object.values(device.entities).map(id=>entries.find(e=>e.entity_id===id)?.device_id).filter(Boolean));
    const source=this._registries.devices.some(d=>d.id===device.id)?device.id:knownIds.size===1?[...knownIds][0]:null;
    let ids=this._registryLoaded?entries.filter(e=>e.platform==='esphome' && !e.disabled_by && (!source || e.device_id===source) && e.entity_id.startsWith(domain)).map(e=>e.entity_id):Object.keys(states).filter(id=>id.startsWith(domain));
    const current=device.entities[role];if(current&&!ids.includes(current))ids.push(current);
    return [...new Set(ids)].sort();
  }
  _picker() {
    if(!this._pickerOpen)return '';
    const {devices,entities,areas}=this._registries;
    const list=espHomeDevices(devices,entities,areas,this._hass?.states || {});
    return `<section class="picker-panel"><h2>Vælg ESPHome-enhed</h2><p class="note">Vælg blandt de ESPHome-enheder, der er tilføjet i Home Assistant. Enheder, der kun findes i ESPHome Builder, skal først tilføjes til Home Assistant.</p><div class="fields"><label class="field">ESPHome-enhed<select data-picker-device="true"><option value="">Vælg en enhed</option>${list.map(d=>`<option value="${escapeHTML(d.id)}" ${d.id===this._pickerDevice?'selected':''}>${escapeHTML(d.display_name)}${d.model?' · '+escapeHTML(d.model):''}</option>`).join('')}</select></label><label class="field">Radarmodel<select data-picker-model="true"><option value="">Vælg radarmodel</option>${Object.keys(ROLES).map(model=>`<option value="${model}" ${model===this._pickerModel?'selected':''}>${model} · ${model==='MR60BHA2'?'Puls og vejrtrækning':'Faldregistrering'}</option>`).join('')}</select></label></div><p class="note">Sensorforslag kobles til den valgte fysiske enhed. Kontrollér dem efter tilføjelsen. Eksisterende koblinger bevares, og samme radar tilføjes ikke to gange.</p><div class="toolbar"><button class="btn primary" data-action="add-picked" ${!this._pickerDevice||!this._pickerModel||this._discovering?'disabled':''}>Tilføj / forbind enhed</button><button class="btn" data-action="close-picker">Luk</button><span class="note">${list.length} ESPHome-enheder</span></div>${!this._discovering&&!list.length?'<p class="note">Ingen ESPHome-enheder i registeret. Kontrollér integrationen ESPHome under Enheder og tjenester.</p>':''}</section>`;
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
    if (action === 'tab') {this._tab = b.dataset.tab;this.render();if(this._tab==='devices'&&!this._registryLoaded&&this._connected)void this._loadRegistries().then(()=>this.render()).catch(()=>{});}
    if(action==='tab' && this._tab==='alerts' && this._connected && !this._targetsLoaded)void this._loadTargets();
    if(action==='save-alerts')this._saveAlerts(b.dataset.id);
    if(action==='save-indicator')this._saveIndicator(b.dataset.id);
    if(action==='test-notification')void this._testNotification(b.dataset.id,b.dataset.testLevel);
    if (action === 'pick' && this._connected)void this._openPicker();
    if (action === 'close-picker'){this._pickerOpen=false;this.render();}
    if (action === 'add-picked')this._addPickedDevice();
    if (action === 'history') void this.loadHistory();
    if (action === 'discover' && this._connected) void this._discover();
    if (action === 'add') {
      const model = b.dataset.model;
      this._commit({...this._config,devices:[...this._config.devices,{id:globalThis.crypto?.randomUUID?.() || 'device-'+Date.now(),model,name:model === 'MR60BHA2' ? 'Puls og vejrtrækning' : 'Faldregistrering',area:'',entities:{}}]});
    }
    if (action === 'remove') this._commit({...this._config,devices:this._config.devices.filter(d=>d.id!==b.dataset.id)});
    if (action === 'csv' && this._historyState === 'ready') {
      const url = URL.createObjectURL(new Blob([toCSV(this._history,this._config.devices)],{type:'text/csv;charset=utf-8'}));
      const a = document.createElement('a'); a.href = url; a.download = `ESPHealth-${new Date().toISOString().slice(0,10)}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    if (action === 'yaml') {
      const text = JSON.stringify(this._config,null,2);
      const url = URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const a = document.createElement('a'); a.href=url; a.download='ESPHealth-opsætning.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  }
  _change(e) {
    const el = e.target;
    if(el.dataset.indicatorKey){const d=this._config.devices.find(x=>x.id===el.dataset.device);this._indicatorDrafts[d.id]={enabled:false,entity_id:'',...d.indicator,...this._indicatorDrafts[d.id],[el.dataset.indicatorKey]:el.type==='checkbox'?el.checked:el.value};return;}
    if(el.dataset.alertKey){const d=this._config.devices.find(x=>x.id===el.dataset.device);const key=el.dataset.alertKey;this._alertDrafts[d.id]={...normalizeAlerts(d.alerts),...this._alertDrafts[d.id],[key]:el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?null:Number(el.value)):el.value};this._refreshTestStatus();return;}
    if(el.dataset.pickerDevice){this._pickerDevice=el.value;const d=this._registries.devices.find(x=>x.id===el.value);this._pickerModel=d?inferModel(d,this._registries.entities,this._hass?.states || {}):'';this.render();return;}
    if(el.dataset.pickerModel){this._pickerModel=el.value;this.render();return;}
    if (el.dataset.chartDevice) {this._chartDevice=el.value;this.render();return;}
    if (el.dataset.hours) { this._hours=Number(el.value); void this.loadHistory(); return; }
    const id = el.dataset.device; const key = el.dataset.key; if (!id || !key) return;
    const devices = this._config.devices.map(d => d.id!==id ? d : {...d,...(el.dataset.entity ? {entities:{...d.entities,[key]:el.value}} : {[key]:el.value})});
    this._commit({...this._config,devices});
  }
  async _loadTargets() {
    try {
      this._targets=await this._hass.notificationTargets();this._targetsLoaded=true;
      for(const select of this.shadowRoot.querySelectorAll('[data-alert-key="notify_service"]')) {
        const selected=select.value;select.innerHTML=this._targetOptions(selected);
      }
    } catch(_){this._alarmError='Beskedmodtagere kunne ikke hentes. Kontrollér forbindelsen til Home Assistant.';this._refreshAlarmStatus();}
  }
  _targetOptions(selected) {
    const targets=[...this._targets];if(selected&&!targets.some(x=>x.id===selected))targets.push({id:selected,name:selected+' · ikke fundet'});
    return targets.map(x=>`<option value="${escapeHTML(x.id)}" ${x.id===selected?'selected':''}>${escapeHTML(x.name)}</option>`).join('');
  }
  _saveAlerts(id) {
    const device=this._config.devices.find(x=>x.id===id);const a={...normalizeAlerts(device.alerts),...this._alertDrafts[id]};
    for(const el of this.shadowRoot?.querySelectorAll('[data-alert-key]') || [])if(el.dataset.device===id)a[el.dataset.alertKey]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?null:Number(el.value)):el.value;
    let error='';try{validateAlerts(a,device.model);}catch(e){error=e.message;}
    this._alarmError=error;
    this._alarmErrorId=id;
    if(error){this._refreshAlarmStatus();return;}
    delete this._alertDrafts[id];
    this._commit({...this._config,devices:this._config.devices.map(d=>d.id===id?{...d,alerts:a}:d)});
  }
  _notificationSettings(id) {
    const d=this._config.devices.find(x=>x.id===id);
    const a={...normalizeAlerts(d.alerts),...this._alertDrafts[id]};
    for(const el of this.shadowRoot.querySelectorAll('[data-alert-key]'))if(el.dataset.device===id&&['notify_service','notification_level'].includes(el.dataset.alertKey))a[el.dataset.alertKey]=el.value;
    return {device_id:id,notify_service:a.notify_service,notification_level:a.notification_level};
  }
  async _testNotification(id,level) {
    if(this._testingId||Date.now()<this._testCooldownUntil||!this._connected||this._hass?.configSaving)return;
    const settings=this._notificationSettings(id);if(level)settings.notification_level=level;
    if(settings.notification_level==='critical'&&settings.notify_service==='persistent_notification.create'){
      this._testMessages[id]='Vælg en telefon eller tablet til en kritisk testbesked.';this._refreshTestStatus();return;
    }
    this._testingId=id;this._testingLevel=settings.notification_level;this._testMessages[id]='Sender testbesked…';this._refreshTestStatus();
    try {
      const result=await this._hass.testNotification(settings);
      this._testMessages[id]=result.message;
    } catch(error){this._testMessages[id]=error.message || 'Testbeskeden kunne ikke sendes. Kontrollér alarmloggen.';}
    finally{
      this._testingId='';this._testCooldownUntil=Date.now()+10000;this._refreshTestStatus();
      clearTimeout(this._testCooldownTimer);this._testCooldownTimer=setTimeout(()=>this._refreshTestStatus(),10010);
    }
  }
  _refreshTestStatus() {
    for(const button of this.shadowRoot.querySelectorAll('[data-action="test-notification"]')){
      const settings=this._notificationSettings(button.dataset.id);if(button.dataset.testLevel)settings.notification_level=button.dataset.testLevel;
      button.disabled=Boolean(this._testingId||Date.now()<this._testCooldownUntil||!this._connected||this._hass?.configSaving);
      button.textContent=this._testingId===button.dataset.id&&this._testingLevel===settings.notification_level?'Sender testbesked…':settings.notification_level==='critical'?'Send kritisk testbesked':'Send testbesked';
    }
    for(const result of this.shadowRoot.querySelectorAll('[data-test-result]'))result.textContent=this._testMessages[result.dataset.testResult] || '';
  }
  _alarmStatus() {
    const status={watching:'Overvåger',paused:'Afventer brugbart signal',pending:'Afventer varighed',active:'Aktiv hændelse',covered:'Dækket af aktiv kritisk alarm'};
    const delivery={sent:'Besked accepteret af Home Assistant',failed:'Beskeden kunne ikke sendes · kontrollér Home Assistant og modtageren',uncertain:'Levering uafklaret efter afbrydelse',cooldown:'Besked begrænset · højst én pr. regel hvert 5. minut',pending:'Afventer afsendelse'};
    const alerts=this._hass?.alerts || {rules:[],events:[]};
    return `${this._hass?.alerts?.running===false?'<div class="error" role="alert">Alarmkontrollen kører ikke. Genstart appen og kontrollér loggen.</div>':''}<div class="alarm-rules">${alerts.rules?.map(r=>`<div class="alarm-rule ${r.state==='active'?'bad':''}"><b>${escapeHTML(this._config.devices.find(d=>d.id===r.device_id)?.name)} · ${escapeHTML(r.label)}</b><span>${status[r.state] || 'Ukendt'}${r.state==='pending'?` · ${Math.max(0,Math.min(r.delay,Math.floor(Date.now()/1000-r.since)))} / ${r.delay} sek.`:''}${r.reason?' · '+escapeHTML(r.reason):''}</span></div>`).join('') || '<p class="note">Ingen aktive alarmregler. Vælg dine indstillinger og gem dem nedenfor.</p>'}</div><h2 style="margin-top:18px">Seneste hændelser</h2>${alerts.events?.map(e=>`<div class="alarm-rule"><b>${new Date(e.at*1000).toLocaleString('da-DK')} · ${escapeHTML(e.name)} · ${escapeHTML(e.label)}</b><span>${escapeHTML(e.reason)}${e.duration?' · mindst '+e.duration+' sek.':''}${e.notification_level?' · '+(e.notification_level==='critical'?'Kritisk besked':'Almindelig besked'):''}</span><span class="${e.delivery==='failed'?'delivery-error':''}">${delivery[e.delivery] || 'Ukendt levering'}${e.ended_at?' · Reglen er ikke længere aktiv':''}</span></div>`).join('') || '<p class="note">Ingen hændelser i den lokale alarmlog.</p>'}`;
  }
  _refreshAlarmStatus() {
    const target=this.shadowRoot.querySelector('#alarm-status');if(target)target.innerHTML=this._alarmStatus();
    for(const button of this.shadowRoot.querySelectorAll('[data-action="save-alerts"]'))button.disabled=Boolean(this._hass?.configSaving);
    for(const error of this.shadowRoot.querySelectorAll('[data-alarm-edit-error]')){const message=this._alarmErrorId===error.dataset.alarmEditError?this._alarmError:'';error.textContent=message || '';error.hidden=!message;}
    this._refreshTestStatus();
  }
  _thresholdEditor(d,a) {
    const number=(key,label,max,delay=false)=>`<label class="field">${label}<input type="number" min="1" max="${max}" step="1" placeholder="${delay?'Sekunder':'Ingen grænse'}" data-device="${escapeHTML(d.id)}" data-alert-key="${key}" value="${a[key]===null?'':a[key]}"></label>`;
    return `<div class="threshold-groups">${[['heart','Puls','slag/min',300],['breath','Vejrtrækning','åndedrag/min',100]].map(([metric,title,unit,max])=>`<section class="threshold-group"><h3>${title}</h3><div class="threshold-head"><span>Betingelse</span><span>Alarm · almindelig besked</span><span>Kritisk alarm · kritisk besked</span></div>${['low','high'].map(direction=>{const key=metric+'_'+direction;return `<div class="threshold-row"><b>${direction==='low'?'Under grænsen':'Over grænsen'}<small>${unit}</small></b><div class="threshold-level">${number(key,'Alarmgrænse · '+(direction==='low'?'under':'over'),max)}${number(key+'_delay','Sammenhængende sekunder',3600,true)}</div><div class="threshold-level critical-level">${number('critical_'+key,'Kritisk grænse · '+(direction==='low'?'under':'over'),max)}${number('critical_'+key+'_delay','Sammenhængende sekunder',3600,true)}</div></div>`;}).join('')}</section>`).join('')}</div><p class="note">Tomme grænser er inaktive. Hver grænse har sin egen timer. Ved normal måling eller tab af brugbar måling starter den pågældende timer forfra. En kritisk alarm sendes uafhængigt af en tidligere almindelig alarm. Mens en kritisk alarm er aktiv, udelades en samtidig almindelig besked for samme betingelse.</p>`;
  }
  _alarms() {
    return `<div class="alarm-intro"><p class="note">Vælg separate grænser og varigheder for alarm og kritisk alarm. Reglerne kører i Home Assistant-appen, også når siden er lukket. Der er ingen medicinske standardgrænser. Gem for hver enhed for at aktivere ændringer.</p><p class="note">Manglende vejrtrækningsmåling kan skyldes bevægelse, placering eller forbindelse og dokumenterer ikke vejrtrækningsstop. Appen erstatter ikke medicinsk overvågning eller akut hjælp.</p></div><div class="device-list" style="margin-top:18px">${this._config.devices.map(d=>{
      const a={...normalizeAlerts(d.alerts),...this._alertDrafts[d.id]};
      const check=(key,label)=>`<label class="check"><input type="checkbox" data-device="${escapeHTML(d.id)}" data-alert-key="${key}" ${a[key]?'checked':''}>${label}</label>`;
      return `<section class="settings-device alarm-settings"><h2>${escapeHTML(d.name)}</h2>${check('enabled','Slå alarmer til for denne enhed')}<label class="field" style="margin-bottom:16px">Beskedmodtager<select data-device="${escapeHTML(d.id)}" data-alert-key="notify_service">${this._targetOptions(a.notify_service)}</select></label>${d.model==='MR60BHA2'?this._thresholdEditor(d,a):''}<h3 style="margin-top:20px">${d.model==='MR60BHA2'?'Signaltab':'Faldsignal og signaltab'}</h3>${check('signal_loss',d.model==='MR60BHA2'?'Giv besked ved manglende målesignal eller forkerte målebetingelser':'Giv besked, hvis faldsignalet bliver utilgængeligt')}${d.model==='MR60FDA2'?check('fall','Giv besked ved muligt fald'):''}<div class="fields"><label class="field">Varighed ved ${d.model==='MR60BHA2'?'signaltab':'faldsignal / signaltab'} · sekunder<input type="number" min="1" max="3600" step="1" data-device="${escapeHTML(d.id)}" data-alert-key="delay" value="${a.delay}"></label><label class="field">Beskedtype ved ${d.model==='MR60BHA2'?'signaltab':'faldsignal / signaltab'}<select data-device="${escapeHTML(d.id)}" data-alert-key="notification_level"><option value="normal" ${a.notification_level==='normal'?'selected':''}>Almindelig besked</option><option value="critical" ${a.notification_level==='critical'?'selected':''}>Kritisk besked · iPhone/iPad</option></select></label></div><p class="note">Kritiske beskeder på iPhone/iPad kræver tilladelse til kritiske advarsler i telefonens notifikationsindstillinger. Én besked pr. hændelse, højst én hvert femte minut pr. betingelse og niveau. Kritisk eskalering blokeres ikke af en almindelig besked.</p><div class="error" role="alert" data-alarm-edit-error="${escapeHTML(d.id)}" ${this._alarmError&&this._alarmErrorId===d.id?'':'hidden'}>${this._alarmErrorId===d.id?escapeHTML(this._alarmError):''}</div><div class="toolbar"><button class="btn primary" data-action="save-alerts" data-id="${escapeHTML(d.id)}" ${this._hass?.configSaving?'disabled':''}>Gem alarmindstillinger</button><button class="btn" data-action="test-notification" data-test-level="normal" data-id="${escapeHTML(d.id)}">Send testbesked</button><button class="btn" data-action="test-notification" data-test-level="critical" data-id="${escapeHTML(d.id)}">Send kritisk testbesked</button></div><p class="note">Testknapperne afprøver beskedmodtageren uden at gemme eller aktivere regler. Højst én test hvert 10. sekund. Home Assistants accept er ikke en kvittering fra telefonen. Afsendelsesfejl vises i loggen og forsøges først igen ved næste hændelse.</p><p class="note" role="status" data-test-result="${escapeHTML(d.id)}">${escapeHTML(this._testMessages[d.id] || '')}</p></section>`;
    }).join('')}</div><section class="panel"><h2>Alarmstatus</h2><div id="alarm-status">${this._alarmStatus()}</div></section>`;
  }
  _vitalMonitor(d, quality) {
    const states=this._hass?.states || {};
    const row=(role,label,unit,usable,symbol)=>{
      const n=numberState(states[d.entities[role]]);
      // This is a frequency-based illustration, never a sampled heartbeat/ECG waveform.
      const duration=usable?60/n:1;
      return `<div class="monitor-channel"><div class="monitor-label">${label}<span>Radar · estimat</span></div><div class="monitor-reading">${usable?fmt(n):'—'}<small>${unit}</small></div><div class="rhythm ${usable?'running':''} ${role}" style="--period:${duration.toFixed(3)}s" aria-hidden="true">${icon(symbol)}<span class="rhythm-line"></span></div><div class="monitor-state">${usable?'Frekvens modtaget':'Intet brugbart signal'}</div></div>`;
    };
    return `<section class="vital-monitor" aria-label="Puls- og vejrtrækningsmonitor">${row('heart_rate','Puls','slag/min',quality.heart_usable,'heart')}${row('breath_rate','Vejrtrækning','åndedrag/min',quality.breath_usable,'breath')}<p class="monitor-caption">Rytmeanimation ud fra frekvens · ikke EKG eller målte hjerteslag</p></section>`;
  }
  _diagnostics(d, quality) {
    const states=this._hass?.states || {};
    const raw=role=>{const s=states[d.entities[role]];if(!this._connected)return 'Afbrudt';const n=numberState(s);return n===null?'Ukendt':fmt(n,1);};
    return `<details class="diagnostics" data-diagnostics="${escapeHTML(d.id)}" ${this._diagnosticOpen?.has(d.id)?'open':''}><summary>Hvorfor vises der streger? · Sensorens rådata</summary><p>${escapeHTML(quality.label)}. Sid stille med overkroppen rettet mod en stabil radar, 0,5–1,5 m væk.</p><div class="raw-values"><span>Rå puls <b>${raw('heart_rate')}</b></span><span>Rå vejrtrækning <b>${raw('breath_rate')}</b></span></div><p>0 betyder, at radaren ikke leverer en brugbar frekvens. Det betyder ikke en bekræftet puls eller vejrtrækning på nul.</p>${['heart_rate','breath_rate','distance','num_targets'].map(role=>{const s=states[d.entities[role]];const age=readingAge(s);return `<p>${ROLES[d.model][role]} · ${escapeHTML(d.entities[role] || 'Ikke valgt')}<br>Senest rapporteret: ${this._connected&&Number.isFinite(age)?fmt(age)+' sekunder siden':'Ukendt'}</p>`;}).join('')}<p>Ved stabile tal skal ESPHome sende gentagne målinger med force_update: true. Appen kan ikke bekræfte, om selve radarens estimat er nyt.</p></details>`;
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
      return `<article class="device">${header}<div class="sensor-body">${this._vitalMonitor(d,quality)}<div class="status ${quality.kind}"><i class="dot"></i>${quality.label}</div>${details([['Tilstedeværelse',presenceLabel],['Antal (estimat)',this._connected?fmt(numberState(s('num_targets'))):'—'],['Afstand',distance===null?'Ukendt':fmt(distance,2)+' m'],['Lys',lux===null?'—':fmt(lux)+' lx']])}${this._diagnostics(d,quality)}<p class="hint" style="margin-top:13px">Person og radar skal være i ro. Stilleståen og sensorens målekvalitet kan ikke bekræftes af appen.</p></div></article>`;
    }
    const fall = this._connected ? binaryState(s('fall')) : null;
    const kind = fall===true?'bad':fall===false?'good':'muted';
    return `<article class="device">${header}<div class="sensor-body"><div class="fall-visual ${kind}"><div class="ring">${icon('shield')}</div><strong>${fall===true?'Muligt fald registreret':fall===false?'Intet fald registreret':'Faldstatus er ukendt'}</strong><div class="hint">${fall===true?'Kontrollér personen og omgivelserne':fall===false?'Sensorens aktuelle registrering':'Kontrollér forbindelse og valg af entitet'}</div></div><div class="status ${kind}"><i class="dot"></i>${fall===true?'Faldsignalet er aktivt':fall===false?'Faldsignalet er inaktivt':'Intet tilgængeligt faldsignal'}</div>${details([['Tilstedeværelse',presenceLabel],['Lys',lux===null?'—':fmt(lux)+' lx'],['Status ændret',this._connected&&s('fall')?time(s('fall').last_changed):'—']])}<p class="hint" style="margin-top:13px">Vælg beskeder under Alarmer i ESPHealth.</p></div></article>`;
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
    return `<section class="panel"><div class="chart-head"><div><h2>Puls & vejrtrækning</h2><p>Historik fra Home Assistant Recorder</p></div><div class="toolbar">${bha.length?`<select data-chart-device="true" aria-label="Enhed i grafen">${bha.map(d=>`<option value="${escapeHTML(d.id)}" ${d.id===this._chartDevice?'selected':''}>${escapeHTML(d.name)}</option>`).join('')}</select>`:''}<select data-hours="true" aria-label="Historikperiode">${[1,6,12,24].map(n=>`<option value="${n}" ${this._hours===n?'selected':''}>Seneste ${n===1?'time':n+' timer'}</option>`).join('')}</select><button class="btn" data-action="history" ${!this._connected||this._hass?.configSaving||this._historyState==='loading'?'disabled':''}>Opdatér</button></div></div>${this._chart()}</section>`;
  }
  _events() {
    const events = this._config.devices.filter(d=>d.entities.fall).flatMap(d=>(this._history[d.entities.fall] || []).filter(r=>r.state==='on').map(r=>({...r,name:d.name}))).sort((a,b)=>b.at-a.at);
    return `<section class="panel"><div class="section-head"><h2>Faldsignaler i perioden</h2><button class="btn" data-action="csv" ${this._historyState!=='ready'?'disabled':''}>Eksportér CSV</button></div>${events.length?events.map(e=>`<div class="history-row"><time>${time(e.at)}</time><span>${escapeHTML(e.name)}</span><span class="badge">Faldsignal aktivt</span></div>`).join(''):'<p class="note">Ingen aktive faldsignaler i den hentede historik. Manglende historik er ikke dokumentation for, at der ikke er sket et fald.</p>'}<p class="hint">Et signal ved periodens begyndelse kan være startet tidligere. Tiderne kommer fra Recorder og er ikke en komplet alarmlog.</p></section>`;
  }
  _settings() {
    const states=this._hass?.states || {};
    return `<div class="toolbar" style="margin-bottom:18px"><button class="btn primary" data-action="discover" ${!this._connected||this._discovering?'disabled':''}>${this._discovering?'Søger…':'Find Seeed-enheder'}</button><button class="btn" data-action="pick" ${!this._connected||this._discovering?'disabled':''}>Vælg ESPHome-enhed</button><button class="btn" data-action="add" data-model="MR60BHA2">+ MR60BHA2</button><button class="btn" data-action="add" data-model="MR60FDA2">+ MR60FDA2</button><button class="btn" data-action="yaml">Eksportér opsætning</button></div>${this._error?`<div class="error" role="status">${escapeHTML(this._error)}</div>`:''}${this._picker()}<p class="note">Kontrollér alle forslag. Vælg de entiteter, der hører til den enkelte radar. Navne alene garanterer ikke korrekt kobling.</p><div class="device-list">${this._config.devices.map(d=>`<section class="settings-device"><div class="toolbar"><h2>${escapeHTML(d.model)}</h2><button class="btn" data-action="remove" data-id="${escapeHTML(d.id)}">Fjern fra visningen</button></div><div class="fields"><label class="field">Navn<input data-device="${escapeHTML(d.id)}" data-key="name" value="${escapeHTML(d.name)}" maxlength="100"></label><label class="field">Område<input data-device="${escapeHTML(d.id)}" data-key="area" value="${escapeHTML(d.area)}" maxlength="100"></label>${Object.entries(ROLES[d.model]).map(([role,label])=>{
      const domain=['presence','fall'].includes(role)?'binary_sensor.':'sensor.';
      const current=d.entities[role];
      const ids=this._entityOptions(d,role);
      return `<label class="field">${label}<select data-device="${escapeHTML(d.id)}" data-key="${role}" data-entity="true"><option value="">Ikke valgt</option>${ids.map(id=>`<option value="${escapeHTML(id)}" ${id===current?'selected':''}>${escapeHTML(states[id]?.attributes?.friendly_name || id)} — ${escapeHTML(id)}</option>`).join('')}</select></label>`;
    }).join('')}</div>${this._indicatorPanel(d)}</section>`).join('')}</div><p class="note">Opsætningen gemmes i Home Assistant-appen og bruges på alle dine enheder. Status for lagringen vises øverst.</p>`;
  }
  render() {
    if (!this.shadowRoot) return;
    const devices=this._config.devices;
    const states=this._hass?.states || {};
    const activeFalls=this._connected?devices.filter(d=>binaryState(states[d.entities.fall])===true):[];
    const present=this._connected?devices.filter(d=>binaryState(states[d.entities.presence])===true).length:0;
    const mapped=devices.filter(d=>Object.values(d.entities).some(Boolean)).length;
    this.shadowRoot.innerHTML=`<style>${css}${monitorCSS}</style><ha-card><div class="shell"><aside class="side"><div class="brand">${icon('pulse')}<span>ESP<span>Health</span></span></div><div class="caption">Dit overblik</div>${[['overview','grid','Overblik'],['history','history','Historik'],['alerts','shield','Alarmer'],['devices','settings','Enheder']].map(([id,i,label])=>`<button class="nav ${this._tab===id?'active':''}" data-action="tab" data-tab="${id}" aria-label="${label}" aria-pressed="${this._tab===id}">${icon(i)}<span>${label}</span></button>`).join('')}<div class="side-foot"><strong>Lokalt. Kontaktløst. Dit.</strong>ESPHome → Home Assistant<br>ESPHealth ${VERSION}</div></aside><main class="body"><div class="topbar"><div class="breadcrumb">Dit hjem <span aria-hidden="true">/</span> <b>${this._tab==='overview'?'Overblik':this._tab==='history'?'Historik':this._tab==='alerts'?'Alarmer':'Enheder'}</b></div><span class="pill ${this._connected?'':'muted'}"><i class="dot"></i>${this._connected?'Home Assistant tilsluttet':'Home Assistant afbrudt'}</span></div><div class="heading"><div><div class="caption">ESPHealth</div><h1>${escapeHTML(this._tab==='overview'?(this._config.title || 'Dit hjem, i overblik'):this._tab==='history'?'Se tilbage på målingerne':this._tab==='alerts'?'Alarmer, du selv vælger':'Dine enheder')}</h1><p class="sub">${this._tab==='overview'?'Kontaktløs registrering af puls, vejrtrækning og mulige fald.':this._tab==='history'?'Se registrerede sensorværdier og hent dem som CSV.':this._tab==='alerts'?'Grænser, signaltab og beskeder via Home Assistant.':'Forbind dine Seeed-radarer med de rigtige sensordata.'}</p></div>${this._tab==='overview'?`<button class="btn" data-action="tab" data-tab="devices">${icon('settings')}Enheder</button>`:''}</div>${!this._connected&&devices.length?'<div class="alert" role="status">Liveforbindelsen er afbrudt. Aktuel puls, vejrtrækning og faldstatus kan ikke vises.</div>':''}${(this._tab==='alerts'?[]:(this._hass?.alerts?.rules || [])).filter(r=>r.state==='active'&&r.rule!=='fall').map(r=>`<div class="alert" role="alert"><div><b>${escapeHTML(this._config.devices.find(d=>d.id===r.device_id)?.name)} · ${escapeHTML(r.label)}</b><br>${escapeHTML(r.reason)} Kontrollér personen og sensoren.</div></div>`).join('')}${(this._tab==='alerts'?[]:activeFalls).map(d=>`<div class="alert" role="alert">${icon('shield')}<div><b>Muligt fald · ${escapeHTML(d.name)}</b><br>Kontrollér personen og omgivelserne. Sensorens faldsignal er aktivt.</div></div>`).join('')}${this._tab==='devices'?this._settings():this._tab==='alerts'?this._alarms():!devices.length?`<div class="panel empty">${icon('radar')}<h2>Giv dine sensorer en plads</h2><p class="sub">Tilføj en MR60BHA2 til puls og vejrtrækning<br>eller en MR60FDA2 til faldregistrering.</p><button class="btn primary" data-action="tab" data-tab="devices">Opsæt enheder ${icon('arrow')}</button></div>`:this._tab==='history'?this._historyPanel()+this._events():`<div class="summary"><div class="stat"><small>Enheder i overblikket</small><strong>${devices.length.toString().padStart(2,'0')}</strong><em>${mapped} med valgte entiteter</em></div><div class="stat"><small>Radarer med tilstedeværelse</small><strong>${this._connected?present.toString().padStart(2,'0'):'—'}</strong><em>Dette er ikke et persontal</em></div><div class="stat"><small>Aktive faldsignaler</small><strong>${this._connected?activeFalls.length.toString().padStart(2,'0'):'—'}</strong><em>Kun tilgængelige signaler</em></div><div class="stat"><small>Datakilde</small><strong style="font-size:17px;margin-top:13px">Home Assistant</strong><em>Ingen ekstra datasky</em></div></div><div class="section-head"><h2>Rum & sensorer</h2><span>${devices.length} enheder</span></div><div class="devices">${devices.map(d=>this._device(d)).join('')}</div>${this._historyPanel()}`}<footer class="bottom"><span>Sensorestimater · Ikke medicinsk udstyr eller et medicinsk alarmsystem</span><span>Historik opdateres med knappen Opdatér</span></footer></main></div></ha-card>`;
    this._refreshTestStatus();this._refreshIndicatorStatus();
  }
}
customElements.define('esp32health-dashboard',ESP32HealthDashboard);
