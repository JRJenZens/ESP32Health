// Small Home Assistant WebSocket adapter. Credentials stay in memory only.
export function websocketURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Brug en http:// eller https:// adresse uden loginoplysninger, query eller fragment.');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/$/, '') + '/api/websocket';
  return url.href;
}
export class HAClient {
  constructor({onState=()=>{},onStatus=()=>{},WebSocketClass=globalThis.WebSocket}={}) {
    this.onState=onState;this.onStatus=onStatus;this.WebSocketClass=WebSocketClass;
    this.states={};this.connected=false;this._pending=new Map();this._nextId=1;this._attempt=0;this._stopped=true;
  }
  connect(url, token) {
    this.close(); this._url=websocketURL(url);this._token=token.trim();
    if(!this._token) throw new Error('Indtast et Home Assistant-adgangstoken.');
    this._stopped=false;this._open();
  }
  _open() {
    if(this._stopped)return;
    this.onStatus(this._attempt?'Forbindelsen er afbrudt. Prøver igen…':'Forbinder til Home Assistant…');
    let socket;
    try { socket=new this.WebSocketClass(this._url); } catch (_) { this._retry(); return; }
    this._socket=socket;this._buffer=[];this._initializing=true;
    this._authTimer=setTimeout(()=>socket.close(),15000);
    socket.onmessage=async event=>{
      if(socket!==this._socket)return;
      let msg;try{msg=JSON.parse(event.data);}catch(_){return;}
      if(msg.type==='auth_required')socket.send(JSON.stringify({type:'auth',access_token:this._token}));
      else if(msg.type==='auth_invalid') {
        this.close();this.onStatus('Login blev afvist. Kontrollér dit adgangstoken.');
      } else if(msg.type==='auth_ok') {
        clearTimeout(this._authTimer);
        try {
          await this.callWS({type:'subscribe_events',event_type:'state_changed'});
          const initial=await this.callWS({type:'get_states'});
          if(socket!==this._socket)return;
          this.states=Object.fromEntries(initial.map(s=>[s.entity_id,s]));
          this._buffer.forEach(data=>this._apply(data));this._buffer=[];this._initializing=false;
          this.connected=true;this._attempt=0;this.onState(this.hass);this.onStatus('Home Assistant tilsluttet');
          this._pingTimer=setInterval(()=>{this.callWS({type:'ping'}).catch(()=>socket.close());},30000);
        }catch(_){socket.close();}
      } else if(msg.type==='result' || msg.type==='pong') {
        const pending=this._pending.get(msg.id);if(!pending)return;
        this._pending.delete(msg.id);clearTimeout(pending.timer);
        if(msg.success===false)pending.reject(new Error(msg.error?.code || 'Home Assistant afviste forespørgslen.'));
        else pending.resolve(msg.result);
      } else if(msg.type==='event' && msg.event?.event_type==='state_changed') {
        if(this._initializing)this._buffer.push(msg.event.data);
        else {this._apply(msg.event.data);this.onState(this.hass);}
      }
    };
    socket.onclose=()=>{
      if(socket!==this._socket)return;
      this._socket=null;this._clearTimers();this._rejectPending();
      this.connected=false;this.states={};this.onState(this.hass);this._retry();
    };
    socket.onerror=()=>{socket.close();};
  }
  _apply(data) {
    if(data?.new_state)this.states={...this.states,[data.entity_id]:data.new_state};
    else if(data?.entity_id){const states={...this.states};delete states[data.entity_id];this.states=states;}
  }
  _retry() {
    if(this._stopped)return;
    this.connected=false;this.onState(this.hass);
    this.onStatus('Forbindelsen er afbrudt. Prøver igen…');
    this._retryTimer=setTimeout(()=>this._open(),Math.min(30000,1000*2**Math.min(this._attempt++,5)));
  }
  _clearTimers(){clearTimeout(this._authTimer);clearInterval(this._pingTimer);clearTimeout(this._retryTimer);}
  _rejectPending(){for(const p of this._pending.values()){clearTimeout(p.timer);p.reject(new Error('Forbindelsen er lukket.'));}this._pending.clear();}
  callWS(command) {
    if(!this._socket || this._socket.readyState!==1)return Promise.reject(new Error('Home Assistant er ikke tilsluttet.'));
    const id=this._nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this._pending.delete(id);reject(new Error('Forespørgslen tog for lang tid.'));},20000);
      this._pending.set(id,{resolve,reject,timer});
      try{this._socket.send(JSON.stringify({...command,id}));}catch(error){clearTimeout(timer);this._pending.delete(id);reject(error);}
    });
  }
  get hass(){return {states:this.states,connected:this.connected,callWS:command=>this.callWS(command)};}
  close() {
    this._stopped=true;this._token='';this._clearTimers();
    const socket=this._socket;this._socket=null;if(socket)socket.close();this._rejectPending();
    this.connected=false;this.states={};this.onState(this.hass);
  }
}
