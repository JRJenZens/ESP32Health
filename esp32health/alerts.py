"""Opt-in advisory alerts. A missing radar signal never means confirmed apnea."""
import asyncio
import hashlib
import json
import math
import os
import re
import time
from datetime import datetime
from pathlib import Path

DEFAULT_ALERTS = {'enabled': False, 'heart_low': None, 'heart_high': None,
                  'breath_low': None, 'breath_high': None, 'signal_loss': False,
                  'fall': False, 'delay': 30, 'notify_service': 'persistent_notification.create'}
LABELS = {'heart_low': 'Puls under din grænse', 'heart_high': 'Puls over din grænse',
          'breath_low': 'Vejrtrækning under din grænse', 'breath_high': 'Vejrtrækning over din grænse',
          'signal_loss': 'Målesignal mangler', 'fall': 'Muligt fald registreret'}


def valid_target(service):
    return isinstance(service, str) and (service == 'persistent_notification.create'
        or re.fullmatch(r'notify\.mobile_app_[a-z0-9_]+', service) is not None)


def validate_alerts(value, model):
    if not isinstance(value, dict) or value.keys() - DEFAULT_ALERTS.keys():
        raise ValueError('Ukendte alarmindstillinger.')
    result = {**DEFAULT_ALERTS, **value}
    for key in ('enabled', 'signal_loss', 'fall'):
        if type(result[key]) is not bool:
            raise ValueError('Alarmvalg skal være slået til eller fra.')
    if not valid_target(result['notify_service']):
        raise ValueError('Vælg Home Assistant eller en Companion-app som beskedmodtager.')
    if type(result['delay']) is not int or not 5 <= result['delay'] <= 600:
        raise ValueError('Alarmforsinkelsen skal være 5–600 sekunder.')
    for key in ('heart_low', 'heart_high', 'breath_low', 'breath_high'):
        n = result[key]
        maximum = 300 if key.startswith('heart') else 100
        if n is not None and (type(n) not in (int, float) or not math.isfinite(n) or not 0 < n <= maximum):
            raise ValueError('Alarmgrænser skal være positive tal inden for feltets interval.')
        if model != 'MR60BHA2' and n is not None:
            raise ValueError('Puls- og vejrtrækningsalarmer kræver MR60BHA2.')
    for role in ('heart', 'breath'):
        low, high = result[role+'_low'], result[role+'_high']
        if low is not None and high is not None and low >= high:
            raise ValueError('Den nedre grænse skal være lavere end den øvre.')
    if model != 'MR60FDA2' and result['fall']:
        raise ValueError('Faldalarm kræver MR60FDA2.')
    if result['enabled'] and not any(result[k] is not None for k in ('heart_low', 'heart_high', 'breath_low', 'breath_high')) and not result['signal_loss'] and not result['fall']:
        raise ValueError('Vælg mindst én alarmregel, før du aktiverer alarmer.')
    return result


def number(state):
    try:
        raw = state.get('state')
        n = float(raw) if not isinstance(raw, bool) else math.nan
        return n if math.isfinite(n) else None
    except (AttributeError, ValueError, TypeError):
        return None


def age(state, now):
    try:
        stamp = datetime.fromisoformat((state.get('last_reported') or state['last_updated']).replace('Z', '+00:00'))
        return max(0, now - stamp.timestamp()) if stamp.tzinfo else math.inf
    except (AttributeError, KeyError, ValueError, TypeError):
        return math.inf


def quality(device, states, connected, now, stale_after):
    s = lambda role: states.get(device['entities'].get(role), {})
    context = None
    if not connected:
        context = 'Forbindelsen er afbrudt'
    elif s('presence').get('state') == 'off':
        context = 'Ingen person registreret'
    elif s('presence').get('state') != 'on':
        context = 'Tilstedeværelse er ukendt'
    elif number(s('num_targets')) != 1:
        context = 'Antal personer er ikke entydigt'
    else:
        distance = number(s('distance'))
        factor = {'m': 1, 'cm': .01, 'mm': .001, 'ft': .3048, 'in': .0254}.get(s('distance').get('attributes', {}).get('unit_of_measurement'))
        if distance is None or factor is None:
            context = 'Afstand eller måleenhed er ukendt'
        elif not .5 <= distance * factor <= 1.5:
            context = 'Uden for målezonen på 0,5–1,5 m'
        elif any(age(s(role), now) > stale_after for role in ('distance', 'num_targets')):
            context = 'Afstand eller personantal er for gammelt'
    result = {'context': context}
    for role in ('heart_rate', 'breath_rate'):
        n = number(s(role))
        result[role] = n if not context and n is not None and n > 0 and age(s(role), now) <= stale_after else None
    return result


def conditions(device, states, connected, now, stale_after):
    a = {**DEFAULT_ALERTS, **device.get('alerts', {})}
    if not a['enabled']:
        return {}
    result = {}
    if device['model'] == 'MR60BHA2':
        q = quality(device, states, connected, now, stale_after)
        for key in ('heart_low', 'heart_high', 'breath_low', 'breath_high'):
            if a[key] is None:
                continue
            n = q['heart_rate' if key.startswith('heart') else 'breath_rate']
            abnormal = n is not None and (n < a[key] if key.endswith('low') else n > a[key])
            unit = 'slag/min' if key.startswith('heart') else 'åndedrag/min'
            result[key] = (f'{n:g} {unit}; din grænse er {a[key]:g}.' if abnormal else None,
                           n is not None)
        if a['signal_loss']:
            reason = q['context'] or ('Puls eller vejrtrækning er nul, ukendt eller for gammel' if q['heart_rate'] is None or q['breath_rate'] is None else None)
            result['signal_loss'] = (reason, True)
    else:
        fall = states.get(device['entities'].get('fall'), {}).get('state') if connected else None
        if a['fall']:
            result['fall'] = ('Sensorens faldsignal er aktivt' if fall == 'on' else None, fall in ('on', 'off'))
        if a['signal_loss']:
            result['signal_loss'] = ('Faldsignalet eller forbindelsen er utilgængelig' if fall not in ('on', 'off') else None, True)
    return result


class AlertEngine:
    """Runs in the app, independent of open browser windows; never a clinical alarm."""
    def __init__(self, path, notify, on_change=lambda: None):
        self.path = Path(path)
        self.notify = notify
        self.on_change = on_change
        self.pending = {}
        self.rules = []
        self._task = None
        self.document = {'events': [], 'active': {}, 'sent': {}}
        if self.path.exists():
            value = json.loads(self.path.read_text())
            if not isinstance(value, dict) or not isinstance(value.get('events'), list) or not isinstance(value.get('active'), dict) or not isinstance(value.get('sent'), dict):
                raise ValueError('Ugyldig gemt alarmlog. Gendan fra sikkerhedskopi.')
            self.document = value

    def snapshot(self):
        return {'rules': self.rules, 'events': self.document['events'][-50:][::-1],
                'running': self._task is not None and not self._task.done()}

    def _save(self):
        self.document['events'] = self.document['events'][-50:]
        # Retain cooldowns only for recent events or active rules.
        cutoff = time.time() - 86400
        self.document['sent'] = {k: v for k, v in self.document['sent'].items() if v >= cutoff}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix('.tmp')
        try:
            with open(tmp, 'w', encoding='utf-8') as handle:
                os.chmod(tmp, 0o600)
                json.dump(self.document, handle, ensure_ascii=False, allow_nan=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
        finally:
            tmp.unlink(missing_ok=True)

    async def tick(self, config, states, connected, now=None):
        now = time.time() if now is None else now
        current, rules, dirty = set(), [], False
        for device in config['devices']:
            settings = {**DEFAULT_ALERTS, **device.get('alerts', {})}
            fingerprint = hashlib.sha256(json.dumps([device['id'], device['entities'], settings], sort_keys=True).encode()).hexdigest()
            for rule, (reason, measurable) in conditions(device, states, connected, now, config.get('stale_after', 180)).items():
                key = fingerprint + ':' + rule
                current.add(key)
                row = {'device_id': device['id'], 'rule': rule, 'label': LABELS[rule],
                       'state': 'watching' if measurable else 'paused', 'reason': reason}
                if reason:
                    self.pending.setdefault(key, now)
                    row.update(state='pending', since=self.pending[key])
                    if key in self.document['active']:
                        row['state'] = 'active'
                    elif now - self.pending[key] >= settings['delay']:
                        row['state'] = 'active'
                        event = {'id': f'{key[:12]}-{rule}-{int(now*1000)}', 'device_id': device['id'],
                                 'name': device['name'], 'rule': rule, 'label': LABELS[rule],
                                 'at': now, 'reason': reason, 'delivery': 'pending'}
                        self.document['events'].append(event)
                        self.document['active'][key] = event['id']
                        # Save before sending. A restart must not duplicate an uncertain delivery.
                        last_sent = self.document['sent'].get(key, 0)
                        event['delivery'] = 'cooldown' if now - last_sent < 300 else 'uncertain'
                        if event['delivery'] != 'cooldown':
                            self.document['sent'][key] = now
                        self._save()
                        self.on_change()
                        if event['delivery'] != 'cooldown':
                            try:
                                message = f"{device['name']}: {LABELS[rule]}. {reason} Kontrollér personen og sensoren. Radarens estimat er ikke en medicinsk vurdering."
                                if rule == 'signal_loss':
                                    message += ' Manglende signal dokumenterer ikke vejrtrækningsstop.'
                                tag = hashlib.sha256(key.encode()).hexdigest()[:20]
                                await asyncio.wait_for(self.notify(settings['notify_service'], 'ESP32Health · '+LABELS[rule], message, tag), timeout=12)
                                event['delivery'] = 'sent'
                            except (Exception,):
                                # No payload or health data in logs. Failure is visible in the local log.
                                event['delivery'] = 'failed'
                        dirty = True
                else:
                    self.pending.pop(key, None)
                    if measurable and key in self.document['active']:
                        event_id = self.document['active'].pop(key)
                        for event in self.document['events']:
                            if event['id'] == event_id:
                                event['ended_at'] = now
                        dirty = True
                rules.append(row)
        self.pending = {k: v for k, v in self.pending.items() if k in current}
        for key in set(self.document['active']) - current:
            event_id = self.document['active'].pop(key)
            for event in self.document['events']:
                if event['id'] == event_id:
                    event['ended_at'] = now
            dirty = True
        changed = rules != self.rules or dirty
        self.rules = rules
        if dirty:
            self._save()
        if changed:
            self.on_change()

    def start(self, config, bridge):
        async def run():
            while True:
                await self.tick(config(), bridge.states, bridge.connected)
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
