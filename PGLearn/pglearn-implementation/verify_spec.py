#!/usr/bin/env python3
"""Validate this specification package; this does NOT test the PGLearn application."""
import json, re, sys, uuid
from pathlib import Path
R=Path(__file__).resolve().parent
errors=[]
def check(ok, message):
 if not ok: errors.append(message)
def read(p): return json.loads((R/p).read_text())
api=read('contracts/api.json'); ledger=read('tasks.json'); acc=read('tests/acceptance.json'); fix=read('tests/fixtures.json')
ops={}
for path,methods in api['paths'].items():
 for method,op in methods.items():
  oid=op['operationId']; check(oid not in ops,'Duplicate operation '+oid); ops[oid]=op
  expected=set(re.findall(r'\{([^}]+)\}',path))
  actual={p['name'] for p in op['parameters'] if p['in']=='path'}
  check(expected==actual,'Path parameter mismatch '+oid)
  check(all(p['required'] for p in op['parameters'] if p['in']=='path'),'Optional path param '+oid)
  if method in ('post','put','patch','delete') and op['x-access'] not in ('service','webhook'):
   check(any(p['name']=='Idempotency-Key' and p.get('required') for p in op['parameters']),'Missing mutation key '+oid)
  if op['x-access']=='service': check(op['security']==[{'cronBearer':[]}],'Bad job security '+oid)

def resolve_ref(s):
 check(s.startswith('#/'),'External/unhandled ref '+s)
 if not s.startswith('#/'): return
 cur=api
 try:
  for token in s[2:].split('/'):cur=cur[token.replace('~1','/').replace('~0','~')]
 except (KeyError,TypeError):errors.append('Broken JSON reference '+s)
def walk(x):
 if isinstance(x,dict):
  if '$ref' in x:resolve_ref(x['$ref'])
  if x.get('type')=='object' and 'properties' in x:
   check(set(x.get('required',[]))<=set(x['properties']),'Undefined required property')
  for v in x.values():walk(v)
 elif isinstance(x,list):
  for v in x:walk(v)
walk(api)
tasks={t['id']:t for t in ledger['tasks']}; cases={c['id']:c for c in acc['scenarios']}
check(len(tasks)==len(ledger['tasks']),'Duplicate task ID');check(len(cases)==len(acc['scenarios']),'Duplicate acceptance ID')
covered=set();mapped=set()
for tid,t in tasks.items():
 check(t['status'] in ledger['status_values'],'Invalid task status '+tid)
 check(bool(t['implementation_targets']) and bool(t['checks']),'Empty implementation/checks '+tid)
 for dep in t['depends_on']:check(dep in tasks and dep!=tid,'Invalid dependency '+tid+' -> '+dep)
 for cid in t['acceptance_ids']:check(cid in cases,'Unknown acceptance '+cid);covered.add(cid)
 for oid in t['operation_ids']:check(oid in ops,'Unknown operation '+oid);mapped.add(oid)
 for path in t['read']:check((R/path).is_file(),'Missing task input '+path)
check(set(cases)<=covered,'Unassigned scenarios: '+str(sorted(set(cases)-covered)))
check(set(ops)<=mapped,'Unassigned operations: '+str(sorted(set(ops)-mapped)))
visiting=set();done=set()
def visit(tid):
 if tid in visiting: errors.append('Task dependency cycle at '+tid);return
 if tid in done or tid not in tasks:return
 visiting.add(tid)
 for dep in tasks[tid]['depends_on']:visit(dep)
 visiting.remove(tid);done.add(tid)
for tid in tasks:visit(tid)
for cid,c in cases.items():
 check(all(c.get(k) for k in ('given','when','then','layer','requirements')),'Incomplete scenario '+cid)
for p in R.rglob('*.md'):
 text=p.read_text();check(text.count('```')%2==0,'Unbalanced fences '+str(p.relative_to(R)))
 for dest in re.findall(r'\]\(([^)]+)\)',text):
  if re.match(r'\w+://',dest) or dest.startswith('#'):continue
  target=dest.split('#')[0]
  check((p.parent/target).exists(),'Broken link '+str(p.relative_to(R))+' -> '+dest)
for v in fix['ids'].values():
 try:uuid.UUID(v)
 except ValueError:errors.append('Invalid fixture UUID '+v)
check(len(set(fix['ids'].values()))==len(fix['ids']),'Duplicate fixture UUID')
progress=fix['progress'];n=len(progress);required=len(fix['content']['classes'])
percent={u:len(v['completed_classes'])/required*100 for u,v in progress.items()}
check(round(sum(percent.values())/n,1)==fix['expected_report']['average_progress'],'Fixture average incorrect')
check(sum(v==100 for v in percent.values())/n*100==fix['expected_report']['completion_rate'],'Fixture completion rate incorrect')
for u,pct in percent.items():check(round(pct,1)==fix['expected_report']['row_progress_percent'][u],'Fixture row progress incorrect '+u)
try:
 from openapi_spec_validator import validate
 validate(api);print('OpenAPI 3.1 schema validation: PASS')
except ImportError:print('OpenAPI external validator: not installed (structural/reference checks still ran)')
except Exception as exc:errors.append('OpenAPI invalid: '+str(exc))
try:
 from jsonschema import Draft202012Validator, FormatChecker
 for name,schema in api['components']['schemas'].items():Draft202012Validator.check_schema(schema)
 print('JSON Schema component validation: PASS')
 for ex in read('tests/api-examples.json')['examples']:
  schema={'$ref':'#/components/schemas/'+ex['schema'],'components':api['components']}
  actual=Draft202012Validator(schema,format_checker=FormatChecker()).is_valid(ex['value'])
  check(actual==ex['valid'],'API example mismatch: '+ex['name'])
 print('API positive/negative examples checked: '+str(len(read('tests/api-examples.json')['examples'])))
except ImportError:pass
except Exception as exc:errors.append('JSON Schema invalid: '+str(exc))
if errors:
 for err in errors:print('FAIL:',err,file=sys.stderr)
 sys.exit(1)
print(f'PASS: {len(ops)} operations, {len(api["components"]["schemas"])} schemas, {len(tasks)} acyclic tasks, {len(cases)} assigned scenarios, fixture totals and document links.')
print('Application implementation and real-provider acceptance tests have NOT been run by this script.')
