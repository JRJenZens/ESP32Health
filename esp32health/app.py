"""ESP32Health Home Assistant app, served exclusively through Ingress."""
import asyncio
import contextlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from aiohttp import web

from ha_bridge import HABridge, HAUnavailable
from alerts import AlertEngine, validate_alerts

VERSION = '0.3.0'
WEB = Path(__file__).parent / 'web'
ROLES = {
    'MR60BHA2': {'presence', 'heart_rate', 'breath_rate', 'distance', 'num_targets', 'illuminance'},
    'MR60FDA2': {'presence', 'fall', 'illuminance'},
}
DEFAULT_CONFIG = {'title': 'Dit hjem, i overblik', 'devices': [], 'stale_after': 180}


def validate_config(value):
    if not isinstance(value, dict) or not isinstance(value.get('devices'), list):
        raise ValueError('devices skal være en liste.')
    if len(value['devices']) > 50:
        raise ValueError('Højst 50 enheder.')
    result = {'title': value.get('title', DEFAULT_CONFIG['title']),
              'stale_after': value.get('stale_after', 180), 'devices': []}
    if not isinstance(result['title'], str) or len(result['title']) > 150:
        raise ValueError('Titlen er for lang eller ugyldig.')
    if type(result['stale_after']) not in (int, float) or not 30 <= result['stale_after'] <= 86400:
        raise ValueError('stale_after skal være mellem 30 og 86400 sekunder.')
    seen = set()
    for device in value['devices']:
        if not isinstance(device, dict):
            raise ValueError('Enheden skal være et objekt.')
        row = {key: device.get(key, '') for key in ('id', 'name', 'area', 'model')}
        if any(not isinstance(text, str) or len(text) > 150 for text in row.values()):
            raise ValueError('Enhedens tekstfelter er ugyldige.')
        if not row['id'] or row['id'] in seen or row['model'] not in ROLES:
            raise ValueError('Enheden mangler unikt id eller har en ukendt model.')
        seen.add(row['id'])
        entities = device.get('entities')
        if not isinstance(entities, dict) or not entities.keys() <= ROLES[row['model']]:
            raise ValueError('Ukendte sensortyper i entities.')
        for role, entity_id in entities.items():
            domain = 'binary_sensor' if role in ('presence', 'fall') else 'sensor'
            if not isinstance(entity_id, str) or (entity_id and not re.fullmatch(domain + r'\.[a-z0-9_]+', entity_id)):
                raise ValueError('Forkert entitet til ' + role + '.')
        row['entities'] = dict(entities)
        if 'alerts' in device:
            row['alerts'] = validate_alerts(device['alerts'], row['model'])
        result['devices'].append(row)
    return result


class ConfigStore:
    def __init__(self, path):
        self.path = Path(path)
        self.config = validate_config(DEFAULT_CONFIG)
        self.revision = 0
        if self.path.exists():
            value = json.loads(self.path.read_text())
            self.config = validate_config(value['config'])
            self.revision = value['revision']
            if type(self.revision) is not int or self.revision < 0:
                raise ValueError('Ugyldig gemt konfiguration. Gendan fra sikkerhedskopi.')

    def document(self):
        return {'config': self.config, 'revision': self.revision}

    def save(self, config, revision):
        if type(revision) is not int or revision != self.revision:
            raise web.HTTPConflict(text='Opsætningen er ændret i en anden fane. Genindlæs og prøv igen.')
        clean = validate_config(config)
        document = {'config': clean, 'revision': self.revision + 1}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        try:
            with open(temporary, 'w', encoding='utf-8') as handle:
                os.chmod(temporary, 0o600)
                json.dump(document, handle, ensure_ascii=False, allow_nan=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)
        self.config, self.revision = clean, document['revision']
        return document

    def entity_ids(self):
        return {entity_id for device in self.config['devices'] for entity_id in device['entities'].values() if entity_id}


class SnapshotHub:
    def __init__(self):
        self.queues = set()
        self.closed = False

    def publish(self, snapshot):
        if self.closed and snapshot is not None:
            return
        for queue in tuple(self.queues):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(snapshot)


STORE_KEY = web.AppKey('store', ConfigStore)
BRIDGE_KEY = web.AppKey('bridge', object)
HUB_KEY = web.AppKey('hub', SnapshotHub)
ALERTS_KEY = web.AppKey('alerts', AlertEngine)

def history_command(value, allowed_ids):
    if not isinstance(value, dict):
        raise ValueError('Ugyldig historikforespørgsel.')
    ids = value.get('entity_ids')
    if not isinstance(ids, list) or not ids or len(ids) > 300 or any(not isinstance(x, str) or x not in allowed_ids for x in ids):
        raise ValueError('Historik må kun hentes for appens valgte entiteter.')
    try:
        start = datetime.fromisoformat(value['start_time'].replace('Z', '+00:00'))
        end = datetime.fromisoformat(value['end_time'].replace('Z', '+00:00'))
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError()
        seconds = (end - start).total_seconds()
        if not 0 <= seconds <= 86410 or (end - datetime.now(timezone.utc)).total_seconds() > 60:
            raise ValueError()
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ValueError('Vælg en gyldig historikperiode på højst 24 timer.') from None
    return {'type': 'history/history_during_period', 'entity_ids': list(dict.fromkeys(ids)),
            'start_time': start.isoformat(), 'end_time': end.isoformat(),
            'minimal_response': False, 'no_attributes': True, 'significant_changes_only': False}


def create_app(*, config_path='/data/config.json', bridge=None, local=False, token=None):
    store = ConfigStore(config_path)
    hub = SnapshotHub()
    ha = bridge if bridge is not None else HABridge(token or os.environ.get('SUPERVISOR_TOKEN', ''))
    alerts = AlertEngine(Path(config_path).with_name('alerts.json'), ha.notify)

    def snapshot():
        selected = store.entity_ids()
        states = {}
        for entity_id, state in ha.states.items():
            if entity_id in selected:
                states[entity_id] = state
            else:
                # Manual selectors need names/units, not unrelated sensor values.
                states[entity_id] = {'entity_id': entity_id, 'state': 'unknown',
                                     'attributes': state.get('attributes', {})}
        return {'connected': ha.connected, 'states': states, 'alerts': alerts.snapshot()}

    last_snapshot = None

    def changed():
        nonlocal last_snapshot
        current = snapshot()
        if current != last_snapshot:
            last_snapshot = current
            hub.publish(current)

    @web.middleware
    async def protect(request, handler):
        if request.path == '/health' and request.remote in ('127.0.0.1', '::1'):
            return await handler(request)
        if not local and request.remote != '172.30.32.2':
            raise web.HTTPForbidden(text='Adgang kun gennem Home Assistant Ingress.')
        if request.method not in ('GET', 'HEAD') and request.headers.get('X-ESP32Health') != '1':
            raise web.HTTPForbidden(text='Manglende forespørgselssikring.')
        try:
            return await handler(request)
        except ValueError as error:
            return web.json_response({'error': str(error)}, status=400)
        except (HAUnavailable, TimeoutError):
            return web.json_response({'error': 'Home Assistant kunne ikke levere data. Kontrollér forbindelse og Recorder.'}, status=503)

    app = web.Application(middlewares=[protect], client_max_size=128 * 1024)
    app[STORE_KEY], app[BRIDGE_KEY], app[HUB_KEY] = store, ha, hub
    app[ALERTS_KEY] = alerts
    ha.on_change = changed
    alerts.on_change = changed

    async def headers(request, response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'

    app.on_response_prepare.append(headers)

    async def lifecycle(application):
        await ha.start()
        alerts.start(lambda: store.config, ha)
        try:
            yield
        finally:
            hub.publish(None)
            await alerts.close()
            await ha.close()

    async def shutdown(application):
        hub.closed = True
        hub.publish(None)

    app.on_shutdown.append(shutdown)
    app.cleanup_ctx.append(lifecycle)

    async def config_get(request):
        return web.json_response(store.document())

    async def config_put(request):
        value = await request.json()
        if not isinstance(value, dict):
            raise ValueError('Ugyldig konfiguration.')
        clean = validate_config(value.get('config'))
        if any(d.get('alerts', {}).get('enabled') for d in clean['devices']):
            targets = {x['id'] for x in await ha.notification_targets()}
            if any(d.get('alerts', {}).get('enabled') and d['alerts']['notify_service'] not in targets for d in clean['devices']):
                raise ValueError('Den valgte beskedmodtager findes ikke længere i Home Assistant.')
        document = store.save(value.get('config'), value.get('revision'))
        changed()
        return web.json_response(document)

    async def registry_get(request):
        await ha.refresh_registries()
        return web.json_response(ha.registries[request.match_info['kind']])

    async def history(request):
        command = history_command(await request.json(), store.entity_ids())
        return web.json_response(await ha.call(command))

    async def targets(request):
        return web.json_response(await ha.notification_targets())

    async def events(request):
        response = web.StreamResponse(headers={'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no'})
        await response.prepare(request)
        queue = asyncio.Queue(maxsize=1)
        hub.queues.add(queue)
        queue.put_nowait(snapshot())
        try:
            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=15)
                    if data is None:
                        break
                    chunk = 'data: ' + json.dumps(data, ensure_ascii=False) + '\n\n'
                except TimeoutError:
                    chunk = ': keepalive\n\n'
                await asyncio.wait_for(response.write(chunk.encode()), timeout=10)
        except (ConnectionError, asyncio.CancelledError, TimeoutError):
            pass
        finally:
            hub.queues.discard(queue)
        return response

    async def health(request):
        return web.json_response({'status': 'running', 'home_assistant': ha.connected, 'version': VERSION})

    async def asset(request):
        name = request.match_info.get('name', 'index.html')
        if name not in {'index.html', 'app.css', 'app.js', 'dashboard.js', 'icon.svg'}:
            raise web.HTTPNotFound()
        return web.FileResponse(WEB / name)

    app.add_routes([web.get('/health', health), web.get('/api/config', config_get),
                    web.put('/api/config', config_put), web.get('/api/events', events),
                    web.get('/api/registry/{kind:device|entity|area}', registry_get),
                    web.get('/api/notification-targets', targets),
                    web.post('/api/history', history), web.get('/', asset), web.get('/{name}', asset)])
    return app


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    if not os.environ.get('SUPERVISOR_TOKEN'):
        raise SystemExit('ESP32Health skal startes som app i Home Assistant.')
    web.run_app(create_app(), host='0.0.0.0', port=8099, access_log=None, shutdown_timeout=5)
