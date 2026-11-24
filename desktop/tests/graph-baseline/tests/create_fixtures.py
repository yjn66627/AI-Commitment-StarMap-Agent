"""Build wholly fictional Stage A fixtures. No access to customer files or V2.0."""
import json, copy
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
schema=json.loads((ROOT/'src/graph-contract.schema.json').read_text())

def status(kind='source_direct',review='not_reviewed',policy='show',**more):
 return {'assertion_kind':kind,'review_status':review,'render_policy':policy,**more}
def prov(ev=(),src=(),method='quoted_source',**more):
 return {'source_refs':list(src),'evidence_refs':list(ev),'derivation_method':method,**more}
def node(id,kind,label,ev=(),src=(),x=0,y=0,review='not_reviewed',**extra):
 return {'id':id,'type':kind,'label':label,'status':status(review=review),'provenance':prov(ev,src),'sensitivity':'synthetic','position':{'x':x,'y':y},**extra}
def edge(id,a,b,relation,ev,src,kind='source_direct',review='not_reviewed'):
 return {'id':id,'from':a,'to':b,'relation':relation,'status':status(kind,review),'provenance':prov(ev,src,'quoted_source' if kind=='source_direct' else 'ai_inference',**({'notes':'演示规则模拟，不代表实际运行AI模型。'} if kind=='ai_inference' else {}))}

data={
 'schema_version':'proposal-0.2', 'data_class':'fully_synthetic_demo', 'case_id':'SYNTHETIC_CONSTELLATION_01',
 'sources':[
  {'id':'SRC_MEET','origin_kind':'synthetic_meeting','display_name':'虚构会议纪要 · 11月5日','access_state':'synthetic'},
  {'id':'SRC_EMAIL','origin_kind':'synthetic_email','display_name':'虚构沟通邮件 · 11月6日','access_state':'synthetic'},
  {'id':'SRC_CHECK','origin_kind':'synthetic_other','display_name':'虚构离线检查表 · 11月7日','access_state':'synthetic'}
 ],
 'evidence':[
  {'id':'EV_MEET','source_ref':'SRC_MEET','locator':{'section':'虚构纪要 / 第2节','paragraph_index':1,'line_start':3,'line_end':3,'locator_quality':'exact'},'excerpt':'【纯合成】角色甲承诺于2026年11月12日前交付交互原型，由角色甲负责推进。','privacy_state':'synthetic','traceability':'located'},
  {'id':'EV_EMAIL','source_ref':'SRC_EMAIL','locator':{'section':'虚构邮件 / 正文','paragraph_index':0,'line_start':1,'line_end':1,'locator_quality':'exact'},'excerpt':'【纯合成】角色乙承诺整理证据核验清单，但这条消息没有写明完成日期。','privacy_state':'synthetic','traceability':'located'},
  {'id':'EV_CHECK','source_ref':'SRC_CHECK','locator':{'section':'虚构检查表 / 第3项','paragraph_index':2,'line_start':5,'line_end':5,'locator_quality':'exact'},'excerpt':'【纯合成】交互原型的断网浏览器验证尚未完成。此条仅记录检查状态，不构成实际违约判定。','privacy_state':'synthetic','traceability':'located'}
 ],
 'nodes':[
  node('P_A','person','角色甲\n责任人',('EV_MEET',),('SRC_MEET',),130,180),
  node('C_A','commitment','承诺A\n交付交互原型',('EV_MEET','EV_CHECK'),('SRC_MEET','SRC_CHECK'),470,180),
  node('N_EV_MEET','evidence','证据A\n会议纪要',('EV_MEET',),('SRC_MEET',),820,90,attributes={'evidence_id':'EV_MEET'}),
  node('D_A','deadline','期限A\n11月12日',('EV_MEET',),('SRC_MEET',),850,260),
  node('N_EV_CHECK','evidence','证据C\n离线检查',('EV_CHECK',),('SRC_CHECK',),820,405,attributes={'evidence_id':'EV_CHECK'}),
  node('R_A','risk','潜在演示风险\n待人工复核',('EV_CHECK',),('SRC_CHECK',),1190,380),
  node('P_B','person','角色乙\n责任人',('EV_EMAIL',),('SRC_EMAIL',),130,535),
  node('C_B','commitment','承诺B\n整理核验清单',('EV_EMAIL',),('SRC_EMAIL',),470,535,review='pending'),
  node('N_EV_EMAIL','evidence','证据B\n沟通邮件',('EV_EMAIL',),('SRC_EMAIL',),850,640,attributes={'evidence_id':'EV_EMAIL'}),
  {'id':'D_UNKNOWN','type':'deadline','label':'完成日期未知\n未建立连线','status':status('unknown','not_reviewed','placeholder_only',unknown_reason='虚构邮件没有提供承诺B的完成日期，禁止推测。'),'provenance':prov((),(),'unresolved'),'sensitivity':'synthetic','position':{'x':1200,'y':650}}
 ],
 'edges':[
  edge('REL_ASSIGN_A','P_A','C_A','assigned_to',['EV_MEET'],['SRC_MEET']),
  edge('REL_EVID_A','C_A','N_EV_MEET','evidenced_by',['EV_MEET'],['SRC_MEET']),
  edge('REL_DUE_A','C_A','D_A','due_on',['EV_MEET'],['SRC_MEET']),
  edge('REL_CHECK_A','C_A','N_EV_CHECK','evidenced_by',['EV_CHECK'],['SRC_CHECK']),
  edge('REL_RISK_A','C_A','R_A','may_expose_to',['EV_CHECK'],['SRC_CHECK'],'ai_inference','pending'),
  edge('REL_ASSIGN_B','P_B','C_B','assigned_to',['EV_EMAIL'],['SRC_EMAIL']),
  edge('REL_EVID_B','C_B','N_EV_EMAIL','evidenced_by',['EV_EMAIL'],['SRC_EMAIL']),
  {'id':'REL_UNKNOWN_B','from':'C_B','to':'D_UNKNOWN','relation':'unknown','status':status('unknown','not_reviewed','withhold',unknown_reason='原沟通未明确约定完成日期。'),'provenance':prov((),(),'unresolved')}
 ],
 'warnings':[
  {'code':'REVIEW_PENDING','severity':'warning','message':'潜在演示风险是基于虚构检查记录的演示推断，仍待人工复核。','related_ref':'REL_RISK_A'},
  {'code':'UNKNOWN_VALUE','severity':'info','message':'承诺B的完成日期未被说明，未知边已禁止渲染。','related_ref':'REL_UNKNOWN_B'},
  {'code':'UNVERIFIED_OUTPUT','severity':'info','message':'本数据集完全虚构，未调用真实AI模型。'}
 ],
 'review_events':[{'id':'REV_C_A','decision':'confirm','actor_ref':'P_B','occurred_at':'2026-11-08T10:00:00Z','notes':'【纯合成】仅确认承诺A与所列虚构证据的引用对应，不确认现实履约。','target_kind':'node','target_ref':'C_A'}],
 'presentation':{'layout_hint':'preset','title':'完全合成的承诺、责任人、证据与风险网络','fixture_banner':True}
}

# The review event is strictly bound to node C_A. Synthetic only, never a real signature.
data['nodes'][1]['status']=status('source_direct','confirmed','show',review_event_ref='REV_C_A')

# Potential risk is a simulated inference, NEVER an asserted fact.
risk_node=next(n for n in data['nodes'] if n['id']=='R_A')
risk_node['status']=status('ai_inference','pending')
risk_node['provenance']=prov(('EV_CHECK',),('SRC_CHECK',),'ai_inference',notes='仅基于虚构记录的规则模拟推断；未调用真实模型。')

def write_json(path,value): path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
write_json(ROOT/'fixtures/synthetic-valid.json',data)
# Stage A-R schema is authoritative: never overwrite it from the historical A0 draft.
(ROOT/'src/graph-contract.browser.js').write_text('/* Generated from A0 proposal-0.2; authoritative JSON in graph-contract.schema.json */\nwindow.GRAPH_SCHEMA='+json.dumps(schema,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
(ROOT/'fixtures/synthetic-valid.browser.js').write_text('/* Generated from synthetic-valid.json; all content fictional. */\nwindow.SYNTHETIC_FIXTURE='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')

negative={}
def mutate(name,fn):
 x=copy.deepcopy(data);fn(x);negative[name]=x;write_json(ROOT/'fixtures'/f'invalid-{name}.json',x)
mutate('source-ref',lambda d:d['evidence'][0].update(source_ref='SRC_NOT_FOUND'))
mutate('missing-node',lambda d:d['edges'][0].update(to='C_NOT_FOUND'))
mutate('duplicate-id',lambda d:d['nodes'][0].update(id='SRC_MEET'))
mutate('bad-edge-types',lambda d:d['edges'][0].update(from_=''))
# avoid schema errors disguising endpoint checks
negative['bad-edge-types']['edges'][0].pop('from_')
negative['bad-edge-types']['edges'][0]['from']='D_A'
write_json(ROOT/'fixtures/invalid-bad-edge-types.json',negative['bad-edge-types'])
mutate('unsupported-relation',lambda d:d['edges'][0].update(relation='supports'))
mutate('fact-without-proof',lambda d:d['edges'][0]['provenance'].update(evidence_refs=[]))
mutate('inference-upgrade',lambda d:d['edges'][4]['status'].update(assertion_kind='source_direct'))
mutate('missing-review',lambda d:d['nodes'][0]['status'].update(review_status='confirmed',review_event_ref='REV_FAKE'))
mutate('rejected-visible',lambda d:d['edges'][0]['status'].update(review_status='rejected',render_policy='show',review_event_ref='REV_FAKE'))
mutate('unknown-visible',lambda d:d['edges'][7]['status'].update(render_policy='show'))
mutate('private-text',lambda d:d['evidence'][0].update(excerpt='API_KEY=abcd12345678'))
mutate('unsafe-markup',lambda d:d['evidence'][0].update(excerpt='<img src=x onerror=alert(1)>'))
mutate('non-synthetic',lambda d:d.update(data_class='masked_case_export'))
mutate('stolen-evidence',lambda d:d['edges'][0]['provenance'].update(evidence_refs=['EV_EMAIL'],source_refs=['SRC_EMAIL']))
mutate('extra-field',lambda d:d['nodes'][0].update(password='should-not-be-here'))
mutate('bad-evidence-binding',lambda d:d['nodes'][2]['attributes'].update(evidence_id='EV_EMAIL'))
mutate('reversed-locator',lambda d:d['evidence'][0]['locator'].update(line_start=15,line_end=2))

# A-R targeted negative fixtures: deliberately invalid bindings, not real business data.
mutate('review-target-not-found',lambda d:d['review_events'][0].update(target_ref='C_NOT_FOUND'))
mutate('review-wrong-kind',lambda d:d['review_events'][0].update(target_kind='edge'))
mutate('review-cross-node',lambda d:d['review_events'][0].update(target_ref='C_B'))
mutate('review-multiple-nodes',lambda d:d['nodes'][7]['status'].update(review_status='confirmed',review_event_ref='REV_C_A'))
mutate('review-cross-node-edge',lambda d:d['edges'][0]['status'].update(review_status='confirmed',review_event_ref='REV_C_A'))
mutate('review-wrong-decision',lambda d:d['review_events'][0].update(decision='reject'))
mutate('review-target-pending',lambda d:d['review_events'][0].update(target_ref='C_B'))
mutate('review-duplicate-target',lambda d:d['review_events'].append({'id':'REV_SECOND','decision':'confirm','actor_ref':'P_B','occurred_at':'2026-11-08T11:00:00Z','notes':'【纯合成】重复目标负例。','target_kind':'node','target_ref':'C_A'}))
mutate('review-missing-target-field',lambda d:d['review_events'][0].pop('target_ref'))
mutate('review-mismatched-status',lambda d:d['nodes'][1]['status'].update(review_status='not_reviewed'))
mutate('review-forged-target-id',lambda d:d['review_events'][0].update(target_ref='SRC_MEET'))
mutate('review-duplicate-event-id',lambda d:d['review_events'].append({'id':'REV_C_A','decision':'confirm','actor_ref':'P_B','occurred_at':'2026-11-08T11:00:00Z','notes':'【纯合成】事件ID冲突负例。','target_kind':'node','target_ref':'C_B'}))
mutate('review-orphan-pending',lambda d:d['review_events'].append({'id':'REV_ORPHAN','decision':'confirm','actor_ref':'P_B','occurred_at':'2026-11-08T11:00:00Z','notes':'【纯合成】未经对象状态引用的孤立复核。','target_kind':'node','target_ref':'C_B'}))
# Additional valid positive: the same dataset contains independent node and edge review events.
valid_edge_review=copy.deepcopy(data)
valid_edge_review['review_events'].append({'id':'REV_REL_ASSIGN','decision':'confirm','actor_ref':'P_B','occurred_at':'2026-11-08T12:00:00Z','notes':'【纯合成】仅复核虚构责任关系的证据引用。','target_kind':'edge','target_ref':'REL_ASSIGN_A'})
valid_edge_review['edges'][0]['status']=status('source_direct','confirmed','show',review_event_ref='REV_REL_ASSIGN')
write_json(ROOT/'fixtures/synthetic-review-edge-valid.json',valid_edge_review)

print('valid nodes',len(data['nodes']),'edges',len(data['edges']),'invalid fixtures',len(negative))
