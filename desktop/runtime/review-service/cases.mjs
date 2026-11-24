export const cases = Object.freeze([
  {
    id: 'prototype', title: '交互原型验收',
    records: [
      { id: 'P01', source: '合成会议纪要第 1 段', text: '演示角色甲承诺在周五下班前交付交互原型。' },
      { id: 'P02', source: '合成测试记录第 2 段', text: '断网验证仍未完成，验收标准暂未改动。' },
      { id: 'P03', source: '合成跟进消息第 3 段', text: '角色乙答应整理核验清单。消息未约定日期。' },
    ],
  },
  {
    id: 'handoff', title: '交接清单与期限变更',
    records: [
      { id: 'H01', source: '合成交接会议第 1 段', text: '演示角色丙承诺周三提交交接清单初稿。' },
      { id: 'H02', source: '合成沟通纪要第 2 段', text: '角色丁提议将联调推迟一天，尚未收到确认。' },
      { id: 'H03', source: '合成核验表第 3 行', text: '交接清单尚未提供回滚步骤，核验人待确认。' },
    ],
  },
]);
