/* Stage B only: validated report -> adapter -> validated GraphContract -> existing A-R render.
 * No network, persistence, model requests or access to V2.0 artifacts.
 */
(function(){
  'use strict';
  const app=window.__constellationApp;
  function labelFor(code){
    return ({REPORT_SCHEMA:'报告结构与约定输入不一致',REPORT_REF:'报告对象引用错误',ADAPTER_CONFIG:'数据验证配置不可用',
      DUPLICATE_ID:'数据标识存在冲突',MISSING_SOURCE:'找不到对应来源',MISSING_EVIDENCE:'缺少可追溯证据',
      DANGLING_REF:'关系关联的对象不存在',UNVERIFIED_REVIEW:'复核人资料不符合约束',
      REVIEW_TARGET_NOT_FOUND:'复核目标不存在',REVIEW_STATUS_MISMATCH:'复核结果与业务对象不符',
      UNSAFE_TEXT:'存在潜在不安全文本',PROVENANCE_ERROR:'证据来源不匹配',SCHEMA_ERROR:'图谱结构不符合约束'})[code]||'数据安全验证未通过';
  }
  function mark(message,kind){
    const e=document.getElementById('pipeline-state');
    if(e){e.textContent=message;e.dataset.state=kind||'ready';}
  }
  function loadReport(report){
    const result=window.ReportGraphAdapter.adaptReport(report,window.REPORT_INPUT_SCHEMA,window.GRAPH_SCHEMA);
    if(!result.ok){
      const first=result.errors[0]||{code:'REPORT_SCHEMA',path:'$'};
      // No raw input or runtime exception in the human-visible banner.
      app.rejectData([{code:first.code,path:first.path||'$'}],`合成报告被拒绝：${labelFor(first.code)}；未绘制任何关系`);
      mark('报告校验未通过 · 已停止渲染','failed');
      return false;
    }
    const visible=app.loadData(result.graph);
    if(visible){mark('合成报告输入 → 严格适配 → 跨引用与复核校验 → 图谱展示：已完成','ready');}
    else mark('图谱验证未通过 · 已停止渲染','failed');
    return visible;
  }
  function restoreDemo(){return loadReport(window.COMPETITION_SYNTHETIC_REPORT);}
  window.ConstellationIntegration=Object.freeze({loadReport,restoreDemo});
  restoreDemo();
})();
