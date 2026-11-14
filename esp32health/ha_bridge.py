"""Read-only Home Assistant bridge. The Supervisor credential never leaves Python."""
import asyncio
import contextlib
import logging
import time

from alerts import valid_target

import aiohttp

_LOG = logging.getLogger(__name__)
READ_COMMANDS = frozenset({
    'get_states', 'subscribe_events', 'config/device_registry/list',
    'config/entity_registry/list', 'config/area_registry/list',
    'history/history_during_period',
})


def sensor_state(value):
    """Keep only sensor fields needed by this application."""
    if not isinstance(value, dict):
        return None
    entity_id = value.get('entity_id', '')
    if not isinstance(entity_id, str) or not entity_id.startswith(('sensor.', 'binary_sensor.')):
        return None
    attrs = value.get('attributes') or {}
    return {
        'entity_id': entity_id, 'state': value.get('state', 'unknown'),
        'last_updated': value.get('last_updated'),
        'last_changed': value.get('last_changed'),
        'last_reported': value.get('last_reported'),
        'attributes': {k: attrs[k] for k in ('friendly_name', 'unit_of_measurement', 'device_class') if k in attrs},
    }


def registry_rows(kind, values):
    keys = {
        'device': ('id', 'name', 'name_by_user', 'model', 'manufacturer', 'area_id'),
        'entity': ('entity_id', 'device_id', 'name', 'original_name', 'translation_key', 'disabled_by', 'platform'),
        'area': ('area_id', 'name'),
    }[kind]
    return [{k: row[k] for k in keys if k in row} for row in values
            if kind != 'entity' or str(row.get('entity_id', '')).startswith(('sensor.', 'binary_sensor.'))]


class HAUnavailable(Exception):
    pass


class HABridge:
    def __init__(self, token, *, url='ws://supervisor/core/websocket', on_change=lambda: None):
        self._token = token
        self._url = url
        self.on_change = on_change
        self.connected = False
        self.states = {}
        self.registries = {'device': [], 'entity': [], 'area': []}
        self._next_id = 1
        self._pending = {}
        self._ws = None
        self._task = None
        self._reader_task = None
        self._buffer = None
        self._registry_lock = asyncio.Lock()
        self._registry_at = 0

    async def start(self):
        self._task = asyncio.create_task(self._run())

    async def close(self):
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        self._token = ''

    async def call(self, command):
        if command.get('type') not in READ_COMMANDS | {'get_services'}:
            raise ValueError('Only explicit read commands are allowed.')
        return await self._request(command)

    async def notification_targets(self):
        if not self.connected:
            raise HAUnavailable('Home Assistant is disconnected.')
        services = await self.call({'type': 'get_services'})
        result = [{'id': 'persistent_notification.create', 'name': 'Home Assistant · Notifikationer'}]
        for service, description in services.get('notify', {}).items():
            if valid_target('notify.' + service):
                result.append({'id': 'notify.' + service, 'name': description.get('name') or service})
        return result

    async def notify(self, service, title, message, tag):
        # No generic service proxy: fixed notification fields and Companion targets only.
        if not valid_target(service) or service not in {x['id'] for x in await self.notification_targets()}:
            raise ValueError('Notification destination is unavailable.')
        domain, action = service.split('.')
        data = {'title': title, 'message': message}
        if domain == 'persistent_notification':
            data['notification_id'] = 'esp32health_' + tag
        else:
            data['data'] = {'tag': 'esp32health_' + tag}
        await self._request({'type': 'call_service', 'domain': domain, 'service': action, 'service_data': data})

    async def _request(self, command):
        if self._ws is None or self._ws.closed:
            raise HAUnavailable('Home Assistant is disconnected.')
        request_id = self._next_id
        self._next_id += 1
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self._ws.send_json({**command, 'id': request_id})
            return await asyncio.wait_for(future, timeout=30)
        finally:
            self._pending.pop(request_id, None)

    async def refresh_registries(self):
        if not self.connected:
            raise HAUnavailable('Home Assistant is disconnected.')
        async with self._registry_lock:
            if time.monotonic() - self._registry_at < 10:
                return
            kinds = ('device', 'entity', 'area')
            results = await asyncio.gather(*(self.call({'type': f'config/{kind}_registry/list'}) for kind in kinds))
            self.registries = {kind: registry_rows(kind, rows) for kind, rows in zip(kinds, results)}
            self._registry_at = time.monotonic()

    def _apply(self, data):
        entity_id = data.get('entity_id', '')
        value = sensor_state(data.get('new_state'))
        if value:
            self.states[entity_id] = value
        elif entity_id in self.states:
            del self.states[entity_id]

    async def _reader(self):
        async for message in self._ws:
            if message.type != aiohttp.WSMsgType.TEXT:
                continue
            data = message.json()
            if data.get('type') == 'result':
                future = self._pending.get(data.get('id'))
                if future and not future.done():
                    if data.get('success'):
                        future.set_result(data.get('result'))
                    else:
                        future.set_exception(HAUnavailable('Home Assistant rejected a request.'))
            elif data.get('type') == 'event' and data.get('event', {}).get('event_type') == 'state_changed':
                event = data['event'].get('data', {})
                if self._buffer is not None:
                    self._buffer.append(event)
                else:
                    self._apply(event)
                    self.on_change()
        raise HAUnavailable('Home Assistant connection closed.')

    async def _connect(self, session):
        async with session.ws_connect(self._url, heartbeat=30, max_msg_size=32 * 1024 * 1024,
                                      headers={'Authorization': f'Bearer {self._token}'}) as ws:
            self._ws = ws
            hello = await ws.receive_json(timeout=15)
            if hello.get('type') != 'auth_required':
                raise HAUnavailable('Unexpected Home Assistant handshake.')
            await ws.send_json({'type': 'auth', 'access_token': self._token})
            auth = await ws.receive_json(timeout=15)
            if auth.get('type') != 'auth_ok':
                raise HAUnavailable('Supervisor authentication failed.')
            self._buffer = []
            self._reader_task = asyncio.create_task(self._reader())
            try:
                await self.call({'type': 'subscribe_events', 'event_type': 'state_changed'})
                initial = await self.call({'type': 'get_states'})
                self.states = {s['entity_id']: s for value in initial if (s := sensor_state(value))}
                for event in self._buffer:
                    self._apply(event)
                self._buffer = None
                self.connected = True
                self._registry_at = 0
                self.on_change()
                # Registry lookup failure must not discard otherwise usable sensor data.
                try:
                    await self.refresh_registries()
                except (HAUnavailable, TimeoutError):
                    _LOG.warning('Device discovery unavailable; manual entity selection remains available.')
                self.on_change()
                await self._reader_task
            finally:
                self._reader_task.cancel()
                with contextlib.suppress(asyncio.CancelledError, HAUnavailable, aiohttp.ClientError):
                    await self._reader_task

    async def _run(self):
        delay = 1
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            while True:
                try:
                    await self._connect(session)
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    # Never log payloads, URLs, credentials or sensor values.
                    _LOG.warning('Home Assistant connection unavailable (%s); reconnecting.', type(error).__name__)
                finally:
                    was_connected = self.connected
                    self.connected = False
                    self.states = {}
                    self._ws = None
                    self._buffer = None
                    for future in tuple(self._pending.values()):
                        if not future.done():
                            future.set_exception(HAUnavailable('Home Assistant disconnected.'))
                    self.on_change()
                    if was_connected:
                        delay = 1
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)
