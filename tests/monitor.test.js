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

test('Critical mode is saved explicitly and requires a Companion target',()=>{
 const committed=[];const context={_config:{devices:[d]},_alertDrafts:{test:{...DEFAULT_ALERTS,notification_level:'critical'}},_refreshAlarmStatus:()=>{},_commit:c=>committed.push(c)};
 ESP32HealthDashboard.prototype._saveAlerts.call(context,'test');assert.equal(committed.length,0);assert.match(context._alarmError,/telefon/);
 context._alertDrafts.test.notify_service='notify.mobile_app_test';ESP32HealthDashboard.prototype._saveAlerts.call(context,'test');
 assert.equal(committed[0].devices[0].alerts.notification_level,'critical');assert.equal(committed[0].devices[0].alerts.enabled,false);
 assert.equal(DEFAULT_ALERTS.notification_level,'normal');
});
test('Test button sends only the chosen target/mode without saving or arming',async()=>{
 const requests=[];const payload={device_id:'test',notify_service:'notify.mobile_app_test',notification_level:'critical'};
 const context={_connected:true,_testingId:'',_testCooldownUntil:0,_testMessages:{},_notificationSettings:()=>payload,_refreshTestStatus:()=>{},_hass:{testNotification:async value=>{requests.push(value);return {message:'Accepteret af Home Assistant. Kontrollér telefonen.'};}}};
 await ESP32HealthDashboard.prototype._testNotification.call(context,'test');
 assert.deepEqual(requests,[payload]);assert.match(context._testMessages.test,/Kontrollér telefonen/);
 await ESP32HealthDashboard.prototype._testNotification.call(context,'test');assert.equal(requests.length,1);
 clearTimeout(context._testCooldownTimer);
});
test('Failed test is visible and never described as delivered',async()=>{
 const context={_connected:true,_testingId:'',_testCooldownUntil:0,_testMessages:{},_notificationSettings:()=>({notify_service:'notify.mobile_app_test',notification_level:'normal'}),_refreshTestStatus:()=>{},_hass:{testNotification:async()=>{throw Error('Forbindelsen er afbrudt');}}};
 await ESP32HealthDashboard.prototype._testNotification.call(context,'test');
 assert.equal(context._testMessages.test,'Forbindelsen er afbrudt');clearTimeout(context._testCooldownTimer);
});

test('Legacy priorities and their shared duration migrate to the correct tier',async()=>{
 const {normalizeAlerts,validateAlerts}=await import('../esp32health/web/dashboard.js');
 for(const level of ['normal','critical']){
  const a=normalizeAlerts({enabled:true,heart_low:50,heart_high:100,delay:47,notification_level:level,notify_service:'notify.mobile_app_test'});
  const prefix=level==='critical'?'critical_':'';
  assert.equal(a[prefix+'heart_high'],100);assert.equal(a[prefix+'heart_high_delay'],47);
  assert.equal(a[level==='critical'?'heart_high':'critical_heart_high'],null);
  assert.deepEqual(normalizeAlerts(a),a);assert.doesNotThrow(()=>validateAlerts(a,'MR60BHA2'));
 }
});
test('Tier validation rejects inverted severity and invalid durations',async()=>{
 const {normalizeAlerts,validateAlerts}=await import('../esp32health/web/dashboard.js');
 const valid=normalizeAlerts({threshold_version:2,notify_service:'notify.mobile_app_test',heart_low:50,critical_heart_low:40,heart_high:100,critical_heart_high:120,heart_high_delay:30,critical_heart_high_delay:5});
 assert.doesNotThrow(()=>validateAlerts(valid,'MR60BHA2'));
 for(const edit of [{critical_heart_low:60},{critical_heart_high:90},{heart_high_delay:0},{critical_heart_high_delay:3601},{critical_heart_high_delay:null}])assert.throws(()=>validateAlerts({...valid,...edit},'MR60BHA2'));
});
test('Explicit test priority does not change a saved alarm or its durations',async()=>{
 const requests=[];const original={device_id:'test',notify_service:'notify.mobile_app_test',notification_level:'normal'};
 const context={_connected:true,_testingId:'',_testCooldownUntil:0,_testMessages:{},_notificationSettings:()=>({...original}),_refreshTestStatus:()=>{},_hass:{testNotification:async value=>{requests.push(value);return {message:'Accepteret'};}}};
 await ESP32HealthDashboard.prototype._testNotification.call(context,'test','critical');
 assert.equal(requests[0].notification_level,'critical');assert.equal(original.notification_level,'normal');
 clearTimeout(context._testCooldownTimer);
});

test('Alarm configuration comes before status and recent events',()=>{
 const context={_config:{devices:[d]},_hass:{},_alarmStatus:()=>'<p>EVENT LOG</p>',_alertDrafts:{},_testMessages:{},_targetOptions:()=>'',_thresholdEditor:()=>'<p>THRESHOLDS</p>'};
 const html=ESP32HealthDashboard.prototype._alarms.call(context);
 assert.ok(html.indexOf('THRESHOLDS')<html.indexOf('id="alarm-status"'));
 assert.ok(html.indexOf('data-action="save-alerts"')<html.indexOf('EVENT LOG'));
});
test('LED selectors are restricted to compatible entities on the same physical radar',()=>{
 const entries=[{entity_id:'sensor.h',device_id:'physical'}, {entity_id:'select.radar_esphealth_led_status',device_id:'physical',platform:'esphome',original_name:'ESPHealth LED status'}, {entity_id:'select.other_esphealth_led_status',device_id:'other',platform:'esphome',original_name:'ESPHealth LED status'}, {entity_id:'select.radar_height',device_id:'physical',platform:'esphome',original_name:'Height'}];
 const context={_registries:{entities:entries,devices:[]}};
 assert.deepEqual(ESP32HealthDashboard.prototype._indicatorOptions.call(context,d),['select.radar_esphealth_led_status']);
});
test('Saving LED configuration preserves alarm settings',()=>{
 const original={...d,alerts:{...DEFAULT_ALERTS,heart_high:100}};let saved;
 const context={_config:{devices:[original]},_indicatorDrafts:{test:{enabled:true,entity_id:'select.radar_esphealth_led_status'}},_indicatorErrors:{},_brightnessEntity:()=>'',shadowRoot:{querySelectorAll:()=>[]},_commit:c=>{saved=c;}};
 ESP32HealthDashboard.prototype._saveIndicator.call(context,'test');
 assert.equal(saved.devices[0].indicator.enabled,true);assert.deepEqual(saved.devices[0].alerts,original.alerts);
});


test('Brightness control belongs to the selected radar, and saving keeps numeric zero',()=>{
 const target='number.radar_esphealth_led_lysstyrke';
 const device={...d,indicator:{enabled:true,entity_id:'select.radar_esphealth_led_status'},alerts:{...DEFAULT_ALERTS,heart_high:100}};
 const entries=[{entity_id:device.indicator.entity_id,device_id:'physical'}, {entity_id:target,device_id:'physical',platform:'esphome'}, {entity_id:'number.other_esphealth_led_lysstyrke',device_id:'other',platform:'esphome'}, {entity_id:'number.radar_sensitivity',device_id:'physical',platform:'esphome'}];
 const context={_registries:{entities:entries}};
 assert.equal(ESP32HealthDashboard.prototype._brightnessEntity.call(context,device),target);
 let saved;
 Object.assign(context,{_config:{devices:[device]},_indicatorDrafts:{},_indicatorErrors:{},_brightnessEntity:()=>target,shadowRoot:{querySelectorAll:()=>[{dataset:{device:'test',indicatorKey:'brightness'},type:'range',value:'0'}]},_commit:c=>{saved=c;}});
 ESP32HealthDashboard.prototype._saveIndicator.call(context,'test');
 assert.equal(saved.devices[0].indicator.brightness,0);
 assert.equal(saved.devices[0].indicator.brightness_entity_id,target);
 assert.deepEqual(saved.devices[0].alerts,device.alerts);
});

test('Brightness slider explains preserved color strengths and requires explicit save',()=>{
 const device={...d,indicator:{enabled:true,entity_id:'select.radar_esphealth_led_status',brightness:35}};
 const context={_indicatorDrafts:{},_indicatorErrors:{},_hass:{states:{}},_indicatorOptions:()=>[device.indicator.entity_id],_brightnessEntity:()=> 'number.radar_esphealth_led_lysstyrke'};
 const html=ESP32HealthDashboard.prototype._indicatorPanel.call(context,device);
 assert.match(html,/type="range" min="0" max="100" step="1" value="35"/);
 assert.match(html,/Gem LED-indstillinger/);
 assert.match(html,/100 % bevarer den nuværende styrke/);
});
