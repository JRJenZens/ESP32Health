import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= {define:()=>{},get:()=>{}};
const {evaluateBHA,DEFAULT_ALERTS,ESP32HealthDashboard}=await import('../esp32health/web/dashboard.js');
const d={id:'test',model:'MR60BHA2',name:'Test',entities:{presence:'binary_sensor.p',heart_rate:'sensor.h',breath_rate:'sensor.b',distance:'sensor.d',num_targets:'sensor.n'}};
const s=(state,unit)=>({state:String(state),last_updated:new Date().toISOString(),attributes:{unit_of_measurement:unit}});
const fresh=()=>({'binary_sensor.p':s('on'),'sensor.h':s(70),'sensor.b':s(14),'sensor.d':s(100,'cm'),'sensor.n':s(1)});
test('Missing breathing does not hide an independently valid pulse',()=>{
 const values=fresh();values['sensor.b']=s(0);const q=evaluateBHA(d,values);
 assert.equal(q.heart_usable,true);assert.equal(q.breath_usable,false);assert.equal(q.usable,false);
 const html=ESP32HealthDashboard.prototype._vitalMonitor.call({_hass:{states:values}},d,q);
 assert.ok(html.includes('70'));assert.ok(html.includes('ikke EKG'));assert.equal((html.match(/rhythm running/g)||[]).length,1);
});
test('No person or a stale rate stops the illustrative rhythm',()=>{
 const values=fresh();values['binary_sensor.p']=s('off');let q=evaluateBHA(d,values);
 assert.equal(q.heart_usable,false);assert.equal(q.breath_usable,false);
 values['binary_sensor.p']=s('on');values['sensor.h'].last_updated='2000-01-01T00:00:00Z';q=evaluateBHA(d,values);
 assert.equal(q.heart_usable,false);assert.equal(q.breath_usable,true);
});
test('Alarm drafts require deliberate saving and validate ordered limits',()=>{
 const committed=[];const context={_config:{devices:[d]},_alertDrafts:{test:{...DEFAULT_ALERTS,enabled:true,heart_low:100,heart_high:80}},_refreshAlarmStatus:()=>{},_commit:c=>committed.push(c)};
 ESP32HealthDashboard.prototype._saveAlerts.call(context,'test');assert.equal(committed.length,0);assert.match(context._alarmError,/nedre/);
 context._alertDrafts.test.heart_low=40;ESP32HealthDashboard.prototype._saveAlerts.call(context,'test');assert.equal(committed.length,1);assert.equal(committed[0].devices[0].alerts.heart_low,40);
 assert.equal(DEFAULT_ALERTS.enabled,false);assert.equal(DEFAULT_ALERTS.heart_high,null);
});
