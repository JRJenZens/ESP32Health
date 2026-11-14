"""Bounded status-LED control; no arbitrary light or select service proxy."""
import asyncio
import copy
import re
import time

LED_OPTIONS = ('Auto', 'Advarsel', 'Kritisk', 'Slukket')


def validate_indicator(value):
    if not isinstance(value, dict) or set(value) - {'enabled', 'entity_id'}:
        raise ValueError('Ugyldige LED-indstillinger.')
    result = {'enabled': value.get('enabled', False), 'entity_id': value.get('entity_id', '')}
    if type(result['enabled']) is not bool or not isinstance(result['entity_id'], str):
        raise ValueError('Ugyldigt valg af status-LED.')
    if result['entity_id'] and not re.fullmatch(r'select\.[a-z0-9_]+', result['entity_id']):
        raise ValueError('Vælg radarens ESPHealth LED status.')
    if result['enabled'] and not result['entity_id']:
        raise ValueError('Vælg status-LED, før den aktiveres.')
    return result


def led_options(value):
    return isinstance(value, list) and len(value) == 4 and all(isinstance(x, str) for x in value) and set(value) == set(LED_OPTIONS)


def validate_binding(device, registries, states):
    target = device.get('indicator', {}).get('entity_id')
    entries = {e['entity_id']: e for e in registries.get('entity', [])}
    selected = entries.get(target, {})
    owners = {entries[e].get('device_id') for e in device['entities'].values() if e in entries and entries[e].get('device_id')}
    marker = selected.get('original_name') == 'ESPHealth LED status' or re.fullmatch(r'select\..+_esphealth_led_status(?:_\d+)?', target or '')
    if not marker or selected.get('platform') != 'esphome' or selected.get('disabled_by') or len(owners) != 1 or selected.get('device_id') not in owners:
        raise ValueError('Status-LED skal høre til samme fysiske ESPHome-radar som sensorerne.')
    state = states.get(target, {})
    if not led_options(state.get('attributes', {}).get('options')) or state.get('state') not in LED_OPTIONS:
        raise ValueError('ESPHealth LED status er utilgængelig eller mangler den korrekte ESPHome-opsætning.')
    return target


def indicator_mode(device, rules):
    if not device.get('indicator', {}).get('enabled'):
        return 'Slukket'
    if device.get('alerts', {}).get('enabled'):
        active = [r for r in rules if r['device_id'] == device['id'] and r['state'] == 'active']
        if any(r.get('notification_level') == 'critical' for r in active):
            return 'Kritisk'
        if active:
            return 'Advarsel'
    return 'Auto'  # Presence and the heartbeat watchdog run locally on the ESP32.


class IndicatorController:
    def __init__(self, bridge, config, rules, on_change=lambda: None):
        self.bridge, self.config, self.rules, self.on_change = bridge, config, rules, on_change
        self.status = {}
        self.previous = {}
        self.sent = {}
        self.failed = {}
        self._task = None

    def snapshot(self):
        return {'devices': self.status, 'running': self._task is not None and not self._task.done()}

    async def tick(self, now=None):
        now = time.monotonic() if now is None else now
        devices = [d for d in self.config()['devices'] if d.get('indicator', {}).get('entity_id')]
        current = {d['indicator']['entity_id']: d for d in devices}
        retired = {k: d for k, d in self.previous.items() if k not in current}
        self.previous.update({k: copy.deepcopy(d) for k, d in current.items()})
        if not self.bridge.connected:
            new = {d['id']: {'state': 'waiting', 'mode': indicator_mode(d, self.rules())} for d in devices}
            self.sent.clear()
            self.failed.clear()
        else:
            new = {}
            async def apply(device, mode, retire=False):
                target = device['indicator']['entity_id']
                failed = self.failed.get(target)
                if failed and failed[0] == mode and now - failed[1] < 15:
                    if not retire:
                        new[device['id']] = {'state': 'error', 'mode': mode}
                    return
                last = self.sent.get(target)
                due = not last or last[0] != mode or (mode != 'Slukket' and now - last[1] >= 15)
                if not due:
                    if retire:
                        self.previous.pop(target, None)
                        self.sent.pop(target, None)
                    else:
                        new[device['id']] = self.status.get(device['id'], {'state': 'ok', 'mode': mode})
                    return
                try:
                    await asyncio.wait_for(self.bridge.set_indicator(device, mode), timeout=3)
                    self.sent[target] = (mode, now)
                    self.failed.pop(target, None)
                    if retire:
                        self.previous.pop(target, None)
                        self.sent.pop(target, None)
                    else:
                        new[device['id']] = {'state': 'ok', 'mode': mode}
                except Exception:
                    self.failed[target] = (mode, now)
                    # A missed refresh eventually becomes blue on the device; never a stale green.
                    if not retire:
                        new[device['id']] = {'state': 'error', 'mode': mode}
            await asyncio.gather(*(apply(d, indicator_mode(d, self.rules())) for d in devices),
                                 *(apply(d, 'Slukket', True) for d in retired.values()))
        if new != self.status:
            self.status = new
            self.on_change()

    def start(self):
        async def run():
            while True:
                await self.tick()
                await asyncio.sleep(1)
        self._task = asyncio.create_task(run())
        self._task.add_done_callback(lambda _: self.on_change())

    async def close(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
