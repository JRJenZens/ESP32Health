import assert from 'node:assert/strict';
if(!globalThis.HTMLElement)globalThis.HTMLElement=class {};
if(!globalThis.customElements)globalThis.customElements={get:()=>false,define:()=>{}};
const core=await import('../dist/ESP32Health.js');
const {HAClient,websocketURL}=await import('../ha-client.js');
const now=1800000000000;
const state=(v,unit,age=0)=>({state:String(v),attributes:{unit_of_measurement:unit},last_updated:new Date(now-age*1000).toISOString()});
const device={id:'test',model:'MR60BHA2',name:'Test',entities:{presence:'binary_sensor.presence',heart_rate:'sensor.heart',breath_rate:'sensor.breath',distance:'sensor.distance',num_targets:'sensor.targets'}};
const fresh=()=>({'binary_sensor.presence':state('on',null,7200),'sensor.heart':state(68),'sensor.breath':state(14),'sensor.distance':state(112,'cm'),'sensor.targets':state(1)});
class MockSocket {
  static instances=[];
  constructor(url){this.url=url;this.readyState=1;this.sent=[];MockSocket.instances.push(this);}
  send(s){this.sent.push(JSON.parse(s));}
  close(){this.readyState=3;this.onclose?.();}
  async message(data){await this.onmessage({data:JSON.stringify(data)});}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
export const scenarios=[
  ['Native HA connection loss is detected even without hass.connected',()=>{
    assert.equal(core.connectionOnline({states:{},connection:{connected:false}}),false);
    assert.equal(core.connectionOnline({states:{},connection:{connected:true}}),true);
    assert.equal(core.connectionOnline({states:{},connected:false}),false);
    assert.equal(core.connectionOnline(null),false);
  }],

  ['Unknown, unavailable, whitespace and NaN never become zero',()=>{
    for(const s of [undefined,state('unknown'),state('unavailable'),state(''),state('  '),state('NaN'),state('Infinity')])assert.equal(core.numberState(s),null);
    assert.equal(core.numberState(state(0)),0);assert.equal(core.binaryState(state('unknown')),null);assert.equal(core.binaryState(state('off')),false);
  }],
  ['Distance units are explicit, including ESPHome default centimetres',()=>{
    assert.equal(core.distanceMetres(state(112,'cm')),1.12);assert.equal(core.distanceMetres(state(1.12,'m')),1.12);
    assert.equal(core.distanceMetres(state(112)),null);assert.equal(core.distanceMetres(state('unknown','cm')),null);
  }],
  ['One present target in range with fresh positive values is displayed',()=>{assert.equal(core.evaluateBHA(device,fresh(),true,now).usable,true);}],
  ['Unchanging binary presence does not expire as a measurement',()=>{assert.equal(core.evaluateBHA(device,fresh(),true,now).usable,true);}],
  ['No presence suppresses ghost heartbeats',()=>{const s=fresh();s['binary_sensor.presence']=state('off');assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}],
  ['Missing presence, target count and units suppress vital estimates',()=>{
    for(const id of ['binary_sensor.presence','sensor.targets','sensor.distance']){const s=fresh();delete s[id];assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}
  }],
  ['Multiple targets suppress vital estimates',()=>{const s=fresh();s['sensor.targets']=state(2);assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}],
  ['Out-of-range values are never presented as current vitals',()=>{
    for(const cm of [0,49,151,500]){const s=fresh();s['sensor.distance']=state(cm,'cm');assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}
  }],
  ['Both core-zone boundaries are accepted',()=>{for(const cm of [50,150]){const s=fresh();s['sensor.distance']=state(cm,'cm');assert.equal(core.evaluateBHA(device,s,true,now).usable,true);}}],
  ['Expired or timestamp-free numeric values are suppressed',()=>{
    for(const id of ['sensor.heart','sensor.breath','sensor.distance','sensor.targets']){const s=fresh();s[id].last_updated=new Date(now-181000).toISOString();assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}
    const s=fresh();delete s['sensor.heart'].last_updated;assert.equal(core.evaluateBHA(device,s,true,now).usable,false);
  }],
  ['last_reported can verify a repeated unchanged numeric sample',()=>{const s=fresh();s['sensor.heart'].last_updated=new Date(now-999000).toISOString();s['sensor.heart'].last_reported=new Date(now).toISOString();assert.equal(core.evaluateBHA(device,s,true,now).usable,true);}],
  ['Zero vitals and offline connections are suppressed',()=>{
    for(const id of ['sensor.heart','sensor.breath']){const s=fresh();s[id]=state(0);assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}
    assert.equal(core.evaluateBHA(device,fresh(),false,now).usable,false);
  }],
  ['Configuration rejects wrong domains, duplicate ids and unknown models',()=>{
    assert.doesNotThrow(()=>core.validateConfig({devices:[device]}));
    assert.throws(()=>core.validateConfig({devices:[device,device]}));
    assert.throws(()=>core.validateConfig({devices:[{...device,model:'other'}]}));
    assert.throws(()=>core.validateConfig({devices:[{...device,entities:{fall:'sensor.fall'}}]}));
    assert.throws(()=>core.validateConfig({devices:[{...device,entities:{heart_rate:'binary_sensor.heart'}}]}));
    assert.throws(()=>core.validateConfig({devices:[],stale_after:0}));
  }],
  ['Discovery maps only unique candidates on the matching device',()=>{
    const devices=[{id:'1',model:'MR60BHA2',name:'Radar'},{id:'2',model:'other'}];
    const entities=[{device_id:'1',entity_id:'sensor.heart_rate'},{device_id:'2',entity_id:'sensor.heart_rate_other'},{device_id:'1',entity_id:'binary_sensor.has_target'},{device_id:'1',entity_id:'sensor.distance_1'},{device_id:'1',entity_id:'sensor.distance_2'},{device_id:'1',entity_id:'sensor.breath_rate',disabled_by:'user'}];
    const found=core.discoverDevices(devices,entities);
    assert.equal(found.length,1);assert.equal(found[0].entities.heart_rate,'sensor.heart_rate');assert.equal(found[0].entities.presence,'binary_sensor.has_target');assert.equal(found[0].entities.distance,undefined);assert.equal(found[0].entities.breath_rate,undefined);
  }],
  ['Compressed and full history preserve unknown values and sort by time',()=>{
    const h=core.normalizeHistory({'sensor.heart':[{s:'unknown',lu:20},{state:'68',last_updated:'1970-01-01T00:00:10Z'},{s:'1',lu:'bad'}]});
    assert.deepEqual(h['sensor.heart'],[{state:'68',at:10000},{state:'unknown',at:20000}]);
  }],
  ['CSV escapes names and prevents spreadsheet formula injection',()=>{
    const csv=core.toCSV({'sensor.heart':[{state:'=HYPERLINK(1)',at:now}]},[{...device,name:'=SUM(1,2) "test"'}]);
    assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes(`'=SUM(1,2) ""test""`));
    assert.equal(core.escapeHTML('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
  }],
  ['WebSocket URLs support subpaths and reject credentials or query strings',()=>{
    assert.equal(websocketURL('http://homeassistant.local:8123/'),'ws://homeassistant.local:8123/api/websocket');
    assert.equal(websocketURL('https://example.invalid/ha/'),'wss://example.invalid/ha/api/websocket');
    for(const url of ['file:///x','http://user:pass@example.invalid','https://example.invalid/?token=x'])assert.throws(()=>websocketURL(url));
  }],
  ['WebSocket authenticates, buffers events, removes states and clears secrets',async()=>{
    const snapshots=[];const client=new HAClient({WebSocketClass:MockSocket,onState:h=>snapshots.push(h)});
    client.connect('http://example.invalid:8123','test-credential');const socket=MockSocket.instances.at(-1);
    try{
      await socket.message({type:'auth_required'});assert.deepEqual(socket.sent[0],{type:'auth',access_token:'test-credential'});
      const initialized=socket.message({type:'auth_ok'});await tick();
      const sub=socket.sent.find(m=>m.type==='subscribe_events');assert.ok(sub);
      await socket.message({type:'result',id:sub.id,success:true,result:null});await tick();
      const get=socket.sent.find(m=>m.type==='get_states');assert.ok(get);
      await socket.message({type:'event',event:{event_type:'state_changed',data:{entity_id:'sensor.x',new_state:{entity_id:'sensor.x',state:'69'}}}});
      await socket.message({type:'result',id:get.id,success:true,result:[{entity_id:'sensor.x',state:'68'}]});await initialized;
      assert.equal(client.connected,true);assert.equal(client.states['sensor.x'].state,'69');
      await socket.message({type:'event',event:{event_type:'state_changed',data:{entity_id:'sensor.x',new_state:null}}});assert.equal(client.states['sensor.x'],undefined);
      const pending=client.callWS({type:'get_states'});const rejection=assert.rejects(pending,/lukket/);client.close();await rejection;
      assert.equal(client._token,'');assert.equal(client.connected,false);assert.deepEqual(client.states,{});assert.equal(snapshots.at(-1).connected,false);
    }finally{client.close();}
  }],
  ['Invalid authentication does not retry or retain credentials',async()=>{
    const statuses=[];const client=new HAClient({WebSocketClass:MockSocket,onStatus:s=>statuses.push(s)});
    client.connect('http://example.invalid','wrong');const socket=MockSocket.instances.at(-1);
    await socket.message({type:'auth_invalid'});assert.equal(client._token,'');assert.equal(client._stopped,true);assert.match(statuses.at(-1),/afvist/);client.close();
  }],
  ['Synthetic demo fixtures produce usable vitals and readable history',async()=>{
    const {createDemo}=await import('../demo.js');const demo=createDemo();
    try{
      assert.equal(demo.hass.demo,true);assert.equal(core.evaluateBHA(demo.config.devices[0],demo.hass.states).usable,true);
      const result=await demo.hass.callWS({type:'history/history_during_period',start_time:new Date(Date.now()-3600000).toISOString(),end_time:new Date().toISOString(),entity_ids:['sensor.demo_heart_rate']});
      assert.equal(core.normalizeHistory(result)['sensor.demo_heart_rate'].length,100);
    }finally{demo.close();}
  }],
];
export async function runScenarios(){const passed=[];for(const [name,fn]of scenarios){await fn();passed.push(name);}return {passed:passed.length,scenarios:passed};}
