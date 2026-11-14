"""ESPHealth Home Assistant app, served exclusively through Ingress."""
import asyncio
import contextlib
import json
import logging
import math
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from aiohttp import web

from ha_bridge import HABridge, HAUnavailable
from alerts import AlertEngine, LABELS, valid_target, validate_alerts
from indicators import IndicatorController, validate_indicator, validate_binding, validate_brightness_binding

VERSION = '0.5.2'
WEB = Path(__file__).parent / 'web'
ROLES = {
    'MR60BHA2': {'presence', 'heart_rate', 'breath_rate', 'distance', 'num_targets', 'illuminance'},
    'MR60FDA2': {'presence', 'fall', 'illuminance'},
}
DEFAULT_CONFIG = {'title': 'Dit hjem, i overblik', 'devices': [], 'stale_after': 180}


def validate_backup(value):
    """Validate a portable archive without accepting credentials or executable actions."""
    if not isinstance(value, dict) or set(value) != {'format', 'version', 'config', 'alerts'} or value['format'] != 'ESPHealth-backup' or type(value['version']) is not int or value['version'] != 1:
        raise ValueError('Filen er ikke en understøttet ESPHealth-backup.')
    config = validate_config(value['config'])
    log = value['alerts']
    if not isinstance(log, dict) or set(log) != {'events', 'active', 'sent'} or not isinstance(log['events'], list) or len(log['events']) > 50 or any(not isinstance(log[k], dict) or len(log[k]) > 1000 for k in ('active', 'sent')):
        raise ValueError('Ugyldig alarmlog i backup.')
    def timestamp(n):
        return type(n) in (int, float) and math.isfinite(n) and 0 <= n <= time.time() + 300
    fields = {'id', 'device_id', 'name', 'rule', 'label', 'at', 'reason', 'delivery', 'notification_level', 'notify_service', 'duration', 'threshold_version', 'ended_at'}
    required = {'id', 'device_id', 'name', 'rule', 'label', 'at', 'reason', 'delivery'}
    for event in log['events']:
        if not isinstance(event, dict) or not required <= event.keys() or event.keys() - fields:
            raise ValueError('Ugyldig hændelse i backup.')
        if any(not isinstance(event[k], str) or len(event[k]) > 2000 for k in ('id', 'device_id', 'name', 'rule', 'label', 'reason', 'delivery')) or event['rule'] not in {*LABELS, 'test_notification'} or event['delivery'] not in {'pending', 'sent', 'uncertain', 'failed', 'cooldown'}:
            raise ValueError('Ugyldig hændelse i backup.')
        if not timestamp(event['at']) or ('ended_at' in event and not timestamp(event['ended_at'])):
            raise ValueError('Ugyldigt tidspunkt i backup.')
        if ('notify_service' in event and not valid_target(event['notify_service'])) or ('notification_level' in event and event['notification_level'] not in ('normal', 'critical')) or ('duration' in event and (type(event['duration']) is not int or not 1 <= event['duration'] <= 3600)) or ('threshold_version' in event and (type(event['threshold_version']) is not int or event['threshold_version'] != 2)):
            raise ValueError('Ugyldige alarmdata i backup.')
    for key, event_id in log['active'].items():
        if not isinstance(key, str) or not re.fullmatch(r'[a-f0-9]{64}:(' + '|'.join(LABELS) + ')', key) or not isinstance(event_id, str) or len(event_id) > 200:
            raise ValueError('Ugyldig aktiv alarm i backup.')
    # Before tiered alerts, cooldowns used fingerprint:rule keys. Keep those
    # alongside the newer stable hashes so real upgrades retain their history.
    if any(not isinstance(k, str) or not re.fullmatch(r'[a-f0-9]{64}(?::(' + '|'.join(LABELS) + '))?', k) or not timestamp(v) for k, v in log['sent'].items()):
        raise ValueError('Ugyldig beskedhistorik i backup.')
    return config, log


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
    seen, indicator_ids = set(), set()
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
        if 'indicator' in device:
            row['indicator'] = validate_indicator(device['indicator'])
            target = row['indicator']['entity_id']
            if target and target in indicator_ids:
                raise ValueError('Samme status-LED kan kun forbindes med én radar.')
            if target:
                indicator_ids.add(target)
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
INDICATORS_KEY = web.AppKey('indicators', IndicatorController)

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
    indicators = IndicatorController(ha, lambda: store.config, lambda: alerts.rules)
    last_test_at = None

    def snapshot():
        selected = store.entity_ids() | {d.get('indicator', {}).get(k) for d in store.config['devices'] for k in ('entity_id', 'brightness_entity_id')}
        states = {}
        for entity_id, state in ha.states.items():
            if entity_id in selected:
                states[entity_id] = state
            else:
                # Manual selectors need names/units, not unrelated sensor values.
                states[entity_id] = {'entity_id': entity_id, 'state': 'unknown',
                                     'attributes': state.get('attributes', {})}
        return {'connected': ha.connected, 'states': states, 'alerts': alerts.snapshot(), 'indicators': indicators.snapshot()}

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
    app[INDICATORS_KEY] = indicators
    ha.on_change = changed
    alerts.on_change = changed
    indicators.on_change = changed

    async def headers(request, response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'

    app.on_response_prepare.append(headers)

    async def lifecycle(application):
        await ha.start()
        alerts.start(lambda: store.config, ha)
        indicators.start()
        try:
            yield
        finally:
            hub.publish(None)
            await indicators.close()
            await alerts.close()
            await ha.close()

    async def shutdown(application):
        hub.closed = True
        hub.publish(None)

    app.on_shutdown.append(shutdown)
    app.cleanup_ctx.append(lifecycle)

    async def config_get(request):
        return web.json_response(store.document())

    async def validate_live_config(clean):
        if any(d.get('indicator', {}).get('enabled') or d.get('indicator', {}).get('brightness_entity_id') for d in clean['devices']):
            await ha.refresh_registries()
            for device in clean['devices']:
                if device.get('indicator', {}).get('enabled'):
                    validate_binding(device, ha.registries, ha.states)
                if device.get('indicator', {}).get('brightness_entity_id'):
                    validate_brightness_binding(device, ha.registries, ha.states)
        if any(d.get('alerts', {}).get('enabled') for d in clean['devices']):
            targets = {x['id'] for x in await ha.notification_targets()}
            if any(d.get('alerts', {}).get('enabled') and d['alerts']['notify_service'] not in targets for d in clean['devices']):
                raise ValueError('Den valgte beskedmodtager findes ikke længere i Home Assistant.')

    async def config_put(request):
        value = await request.json()
        if not isinstance(value, dict):
            raise ValueError('Ugyldig konfiguration.')
        clean = validate_config(value.get('config'))
        await validate_live_config(clean)
        document = store.save(value.get('config'), value.get('revision'))
        changed()
        return web.json_response(document)

    async def backup_get(request):
        return web.json_response({'format': 'ESPHealth-backup', 'version': 1,
                                  'config': store.config, 'alerts': alerts.document},
                                 headers={'Content-Disposition': 'attachment; filename="ESPHealth-backup.json"'})

    async def backup_import(request):
        # Import is intentionally limited to a fresh installation. Existing data
        # cannot be overwritten by a stale tab or an accidental file selection.
        if store.revision != 0 or store.config['devices']:
            raise web.HTTPConflict(text='Backup kan kun indlæses i en ny, tom installation.')
        clean, log = validate_backup(await request.json())
        await validate_live_config(clean)
        if store.revision != 0 or store.config['devices']:
            raise web.HTTPConflict(text='Installationen er ikke længere tom. Genindlæs appen.')
        previous = alerts.document
        # No awaits between the two writes: alarm evaluation cannot observe a
        # partially imported configuration. A failed config write restores the log.
        try:
            alerts.document = log
            alerts._save()
            document = store.save(clean, 0)
        except Exception:
            alerts.document = previous
            alerts._save()
            raise
        alerts.pending.clear()
        alerts.rules = []
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

    async def test_notification(request):
        nonlocal last_test_at
        value = await request.json()
        if not isinstance(value, dict) or set(value) != {'device_id', 'notify_service', 'notification_level'}:
            raise ValueError('Ugyldig testforespørgsel.')
        device = next((d for d in store.config['devices'] if d['id'] == value['device_id']), None)
        if device is None:
            raise ValueError('Vælg en gemt enhed til testen.')
        settings = validate_alerts({k: value[k] for k in ('notify_service', 'notification_level')}, device['model'])
        now = time.monotonic()
        if last_test_at is not None and now - last_test_at < 10:
            return web.json_response({'error': 'Vent 10 sekunder mellem testbeskeder.'}, status=429,
                                     headers={'Retry-After': '10'})
        last_test_at = now
        try:
            event = await alerts.send_test(device, settings)
        except (HAUnavailable, TimeoutError):
            return web.json_response({'error': 'Testbeskeden kunne ikke sendes. Kontrollér Home Assistant og den valgte modtager. Fejlen er gemt i alarmloggen.'}, status=503)
        destination = 'i Home Assistants notifikationer' if settings['notify_service'] == 'persistent_notification.create' else 'på telefonen'
        return web.json_response({'accepted': True, 'event_id': event['id'],
                                  'message': 'Home Assistant har accepteret testbeskeden. Kontrollér modtagelsen ' + destination + '.'})

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
                    web.post('/api/notifications/test', test_notification),
                    web.get('/api/backup', backup_get), web.post('/api/backup/import', backup_import),
                    web.post('/api/history', history), web.get('/', asset), web.get('/{name}', asset)])
    return app


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    if not os.environ.get('SUPERVISOR_TOKEN'):
        raise SystemExit('ESPHealth skal startes som app i Home Assistant.')
    web.run_app(create_app(), host='0.0.0.0', port=8099, access_log=None, shutdown_timeout=5)
