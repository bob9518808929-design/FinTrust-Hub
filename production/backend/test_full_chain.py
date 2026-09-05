"""全链路 R0-R9 测试脚本."""
import requests, json

BASE = 'http://localhost:8000/api/v1/reform'

print('=== R0 precheck ===')
r = requests.post(f'{BASE}/E001/precheck')
print('verdict:', r.json()['data']['verdict'], 'tier:', r.json()['data']['recommendedTier'])

print('\n=== R1 portrait ===')
r = requests.post(f'{BASE}/E001/portrait')
sc = r.json()['data']
print('subject={}, finance={}, policy={}'.format(sc['subject'], sc['finance'], sc['policy']))

print('\n=== R2 gap-analysis ===')
r = requests.post(f'{BASE}/E001/gap-analysis', json={'current': sc, 'aggression_level': 'balanced'})
gaps = r.json()['data']['gaps']
target = r.json()['data']['target']
print('{} gaps, target policy={}'.format(len(gaps), target['policy']))

print('\n=== R3 plan ===')
r = requests.post(f'{BASE}/E001/plan', json={'current': sc, 'target': target, 'aggression_level': 'balanced'})
phases = r.json()['data']
print('{} phases'.format(len(phases)))
for p in phases:
    print('  - {} ({} actions)'.format(p['name'], len(p['actions'])))

print('\n=== R4 start ===')
r = requests.post(f'{BASE}/E001/start', json={'aggression_level': 'balanced'})
state = r.json()['data']
print('status={}, progress={}, phases={}'.format(state['status'], state['progress'], len(state['phases'])))

print('\n=== R5 execute actions ===')
for phase in state['phases'][:2]:
    for action in phase['actions']:
        r = requests.post(f'{BASE}/E001/actions/{action["id"]}/execute')
        result = r.json()['data']
        print('  {}: success={}, status={}'.format(action['name'], result['success'], result['status']))

print('\n=== R8 monitor ===')
r = requests.get(f'{BASE}/E001/monitor')
monitor = r.json()['data']
print('overallProgress={}'.format(monitor['overallProgress']))

print('\n=== schedule/updates (轮询) ===')
r = requests.get(f'{BASE}/E001/schedule/updates')
updates = r.json()['data']
print('{} updates'.format(len(updates)))

print('\n=== pause ===')
r = requests.post(f'{BASE}/E001/pause')
print('pause status:', r.json()['data']['status'])

print('\n=== resume ===')
r = requests.post(f'{BASE}/E001/resume')
print('resume status:', r.json()['data']['status'])

print('\n=== bank-match ===')
r = requests.post(f'{BASE}/E001/bank-match')
matches = r.json()['data']
print('{} bank matches'.format(len(matches)))

print('\n=== R9 finalize ===')
r = requests.post(f'{BASE}/E001/finalize')
print('finalize code:', r.json()['code'])

print('\n=== R10 store-case ===')
r = requests.post(f'{BASE}/E001/store-case')
print('store-case code:', r.json()['code'])

print('\n=== E002 precheck ===')
r = requests.post(f'{BASE}/E002/precheck')
print('E002 verdict:', r.json()['data']['verdict'], 'tier:', r.json()['data']['recommendedTier'])

print('\n' + '=' * 40)
print('全链路测试通过!')
print('=' * 40)
