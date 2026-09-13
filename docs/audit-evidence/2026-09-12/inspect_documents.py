import collections
import hashlib
import json
import re
from pathlib import Path
import openpyxl

root=Path('D:/Môn học/ATI/ATI_Project')
temp=Path(__file__).parent
text=lambda p:(root/p).read_text(encoding='utf-8-sig')
api=json.loads((temp/'openapi.parsed.json').read_text(encoding='utf-8'))
tools=json.loads(text('testdata/tools.json'))['servers']
cases=json.loads(text('testdata/test-cases.json'))['cases']
names={s['slug']+'.'+t['name'] for s in tools for t in s['tools']}
fr=re.findall(r'^\| \*\*(FR-[A-Z]+-\d+)\*\*.*?\| ([MSC]) \|',text('docs/functional-requirements.md'),re.M)
mvp={'CON':[1,2,3,4,5,6,8],'PLN':[1,2,5,6,7,8,9,10,11],'VAL':list(range(1,9)),'APR':list(range(1,6)),'EXE':list(range(1,11)),'TRC':[1,2,3,5,6,7],'WFM':[1,2],'USR':[1,2,3]}
refs=[]
def walk(x):
    if isinstance(x,dict):
        if '$ref' in x: refs.append(x['$ref'])
        for v in x.values(): walk(v)
    elif isinstance(x,list):
        for v in x: walk(v)
walk(api)
broken=[]
for ref in refs:
    if not ref.startswith('#/'): continue
    obj=api
    try:
        for k in ref[2:].split('/'): obj=obj[k]
    except (KeyError,TypeError): broken.append(ref)
sql=text('db/migrations/0001_init.sql')
src=text('packages/dsl/src/events.ts')
enum_checks={}
for sql_name,zod_name,api_name in [('run_status','RunStatusSchema','RunStatus'),('step_status','StepStatusSchema','StepStatus'),('error_class','ErrorClassSchema',None)]:
    sql_body=re.search(r'CREATE TYPE '+sql_name+r'\s+AS ENUM\s*\((.*?)\);',sql,re.S).group(1)
    sql_body=re.sub(r'--[^\n]*','',sql_body)
    a=re.findall(r"'([^']+)'",sql_body)
    b=re.findall(r'"([a-z_]+)"',re.search(r'export const '+zod_name+r' = z.enum\(\[(.*?)\]\)',src,re.S).group(1))
    enum_checks[sql_name]={'sql':a,'zod':b,'matches':a==b and (api_name is None or api['components']['schemas'][api_name]['enum']==a)}
files=[p for p in root.rglob('*') if p.is_file()]
snapshot={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
copied=[p for p in (root/'packages').rglob('*') if p.is_file()]
rubric=[]
for p in (root.parent/'Final Project').glob('*.xlsx'):
    w=openpyxl.load_workbook(p,read_only=True,data_only=True)
    hits=[]
    for s in w:
        for row in s:
            for c in row:
                if c.value is not None and re.search(r'workflow|architecture|algorithm|rubric|assessment|AI Agent',str(c.value),re.I):
                    hits.append({'sheet':s.title,'cell':c.coordinate,'text':str(c.value)})
    rubric.append({'file':p.name,'sheets':[s.title for s in w],'relevant_hits':hits})
result={
 'source_file_count':len(files),'source_hashes':snapshot,
 'copied_sources_identical':all((temp/p.relative_to(root)).read_bytes()==p.read_bytes() for p in copied),
 'tools_per_server':{s['slug']:len(s['tools']) for s in tools},
 'tools_count':len(names),'test_cases_count':len(cases),
 'case_complexity':dict(collections.Counter(c['complexity'] for c in cases)),
 'test_cases_using_github':[c['id'] for c in cases if any(t.startswith('github.') for t in c['expected_tools'])],
 'cases_nonempty_without_github':[c['id'] for c in cases if c['expected_tools'] and not any(t.startswith('github.') for t in c['expected_tools'])],
 'referenced_tool_count_per_server':{s['slug']:len({t for c in cases for t in c['expected_tools'] if t.startswith(s['slug']+'.')}) for s in tools},
 'missing_expected_tools':sorted({t for c in cases for t in c['expected_tools'] if t not in names}),
 'cases_with_expected_plan':sum('expected_plan' in c for c in cases),
 'fr_count':len(fr),'fr_priority':dict(collections.Counter(p for _,p in fr)),
 'mvp_enumerated_count':sum(len(v) for v in mvp.values()),'mvp_per_module':{k:len(v) for k,v in mvp.items()},
 'sql_table_count':len(re.findall(r'CREATE TABLE\s+\w+',sql)),
 'openapi_schema_count':len(api['components']['schemas']),
 'openapi_operation_count':sum(k in ['get','put','post','delete','patch','options','head','trace'] for path in api['paths'].values() for k in path),
 'broken_openapi_refs':broken,'enum_checks':enum_checks,
 'event_names_match':set(re.findall(r'type: z.literal\("([^"\n]+)"\)',src.split('/* ────────────────────────────────────────────────────────────\n * Union')[0]))==set(api['components']['schemas']['RunEvent']['properties']['type']['enum']),
 'source_tests':[str(p.relative_to(root)) for p in files if re.search(r'\.(test|spec)\.[cm]?[jt]sx?$',p.name)],
 'rubric_search':rubric,
}
(temp/'audit-document-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k not in ['source_hashes','enum_checks']},ensure_ascii=False,indent=2))
