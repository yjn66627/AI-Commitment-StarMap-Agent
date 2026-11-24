"""Independent Draft 2020-12 jsonschema test: not browser/runtime integration evidence."""
import json, pathlib, platform, sys
from jsonschema import Draft202012Validator
ROOT=pathlib.Path(__file__).resolve().parent.parent
report_schema=json.loads((ROOT/'src/report-input.schema.json').read_text())
graph_schema=json.loads((ROOT/'src/graph-contract.schema.json').read_text())
report=json.loads((ROOT/'fixtures/competition-synthetic-report.json').read_text())
graph=json.loads((ROOT/'fixtures/competition-graph-output.json').read_text())
results=[]
def check(n,cb):
 try:cb();results.append({'id':n,'status':'PASS'});print('PASS',n)
 except Exception as e:results.append({'id':n,'status':'FAIL','detail':str(e)[:400]});print('FAIL',n,e)
check('S01_report_schema_is_valid_Draft2020_12',lambda:Draft202012Validator.check_schema(report_schema))
check('S02_graph_schema_is_valid_Draft2020_12',lambda:Draft202012Validator.check_schema(graph_schema))
check('S03_synthetic_report_passes_independent_schema',lambda:Draft202012Validator(report_schema).validate(report))
check('S04_generated_graph_passes_independent_schema',lambda:Draft202012Validator(graph_schema).validate(graph))
def invalid_reports():
 paths=list((ROOT/'fixtures/b_invalid_reports').glob('*.json'))
 assert len(paths)>=7
 for p in paths:
  data=json.loads(p.read_text())
  # Some are syntactically valid reports but intentionally cross-reference invalid.
  if p.stem in ['unknown-v2-field']:
   assert not Draft202012Validator(report_schema).is_valid(data)
check('S05_unknown_field_rejected_by_standard_json_schema',invalid_reports)
summary={'environment':{'python':sys.version.split()[0],'platform':platform.platform(),'validation_library':'python jsonschema Draft202012Validator'},'tests':results,'count':len(results),'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results)}
(ROOT/'evidence/B_INDEPENDENT_SCHEMA_RESULTS.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print('SUMMARY',summary['passed'],'PASS',summary['failed'],'FAIL')
raise SystemExit(bool(summary['failed']))
