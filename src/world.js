window.worldEvents = [
  {
    id: 'works-fengyan', name: '西丽站工地 · 丰盐路', kind: '施工绕行',
    status: '交管公告有期限', observed: '2026-03-10', until: '2026-11-27',
    coord: [113.94796, 22.56120], anchor: '宝深路公交站（公告列明的绕行道路）', near: ['高新北', '石鼓'],
    fact: '建设深圳西丽站期间，丰盐路南海大道至创盛路段自2026年3月13日起封闭，公告期限到2026年11月27日。车辆和行人可经创盛路、宝深路、科技北一路绕行。',
    check: '从目标楼栋走到平常使用的站口，记下围挡让你多绕的路。2026年11月27日之后，以新公告和现场标志判断能否恢复原路。',
    source: '深圳市公安局交通管理局 · 深公交（通）〔2026〕51号',
    url: 'https://szjj.sz.gov.cn/ZWGK/TZGG/GGJG/content/post_12675759.html',
  },
  {
    id: 'industry-tantou', name: '松岗潭头 · 芙蓉路10号', kind: '工业废气',
    status: '核查部分属实，当期阶段性办结', observed: '2026-05-17',
    coord: [113.85328, 22.74440], anchor: '潭头第二工业区公交站（园区参照）', near: ['后亭', '松岗公园'],
    fact: '督察核查发现部分车间收集废气不充分，开门时有废气溢出。5月17日废水总排口和楼顶废气采样均达标，核查未发现废水直排。宝安管理局出具整改建议书。',
    check: '看芙蓉路附近房源时，在具体楼栋窗边分时段观察，并向物业询问该企业整改后的情况。',
    source: '深圳市生态环境局 · 中央生态环境保护督察第八批，件号 D3GD202605160072',
    url: 'https://meeb.sz.gov.cn/attachment/1/1716/1716876/12806595.pdf',
  },
  {
    id: 'industry-heyi', name: '沙井和一学校 · 九九工业园', kind: '工业异味',
    status: '部门回应涉事车间已搬离', observed: '2026-01-13',
    coord: [113.79238, 22.72027], anchor: '兴英科技东公交站（园区周边参照）', near: ['海上田园东', '海上田园南'],
    fact: '宝安生态环境部门答复《问政深圳》，园内一家企业的喷锡车间是所投诉刺激性气味的主要来源。答复时该车间已搬离，周边排查暂未发现废气污染违法行为。',
    check: '看西环路、南环路附近房源时，可问物业2026年1月之后是否收到同类反馈，再按自己通常在家的时段到楼栋核实。',
    source: '深圳新闻网《问政深圳》 · 宝安生态环境部门回应及记者实访',
    url: 'https://www.sznews.com/news/content/2026-01/13/content_31902833.htm',
  },
  {
    id: 'rail-minzhi', name: '民治 · 金亨利都荟首府', kind: '轨道噪声',
    status: '当期已限速，阶段性办结', observed: '2026-06-01',
    coord: [114.02605, 22.62009], anchor: '民宝路中公交站（小区周边参照）', near: ['红山', '深圳北站'],
    fact: '督察确认小区旁运营轨道带来噪声。5月23日起该区段分昼夜限速。6月1日在A座30楼楼顶监测，结果显示限速减轻了影响。',
    check: '看房时在目标卧室开窗、关窗各听几趟车。楼顶监测和个人所在楼层、朝向应分开看。',
    source: '深圳市生态环境局 · 中央生态环境保护督察公开表，件号 X3GD202605310060',
    url: 'https://meeb.sz.gov.cn/attachment/1/1721/1721443/12834824.pdf',
  },
  {
    id: 'airport-noise', name: '宝安机场 · 航空噪声', kind: '机场运行',
    status: '第三跑道已投运，机场设有噪声监测', observed: '2026-05-29',
    coord: [113.813663, 22.624026], anchor: '机场地铁站（航站楼参照）', near: ['机场', '后瑞', '机场东'],
    fact: '深圳机场第三跑道于2025年11月29日投运。生态环境部在2026年报告中将宝安机场列入已部署噪声自动监测系统的机场名单。不同跑道和起降方向会改变经过楼栋上空的航班。',
    check: '对飞行声敏感时，到备选卧室按计划睡觉的时段听，比较窗户朝向与关窗隔声，并向邻居了解不同日期的体感。',
    source: '生态环境部 · 《中国噪声污染防治报告（2026）》',
    url: 'https://www.mee.gov.cn/hjzl/sthjzk/hjzywr/202605/t20260529_1157103.shtml',
    relatedSource: '深圳市交通运输局 · 第三跑道投运及运行模式',
    relatedUrl: 'https://www.sz.gov.cn/cn/xxgk/bmtx/content/post_12527460.html',
  },
  {
    id: 'railway-north', name: '深圳北站 · 假期客流', kind: '铁路枢纽',
    status: '2026年国庆实绩', observed: '2026-10-09',
    coord: [114.03369, 22.61088], anchor: '深圳北站东广场公交站', near: ['深圳北站'],
    fact: '市交通运输局披露，深圳北站10月1日发送旅客46.53万人次，10月7日到达42.36万人次。这两天分别对应国庆出发和返程峰值。',
    check: '平日上班时从小区门口走一次，留意是否要穿站场、经过接客车道。节假日接送安排可另作比较。',
    source: '深圳市交通运输局 · 2026年国庆出行统计',
    url: 'https://www.sz.gov.cn/cn/xxgk/zfxxgj/bmdt/content/post_13012627.html',
  },
  {
    id: 'square-xinan', name: '新安广场 · 晚间活动', kind: '生活噪声',
    status: '核查属实，当期已办结', observed: '2026-05-17',
    coord: [113.900945, 22.561375], anchor: '新安广场东南角停车场（高德点位）', near: ['灵芝', '新安公园'],
    fact: '5月17日，公安部门在广场核查到9支广场舞队伍和5处露天KTV。活动集中在19至21时，部分音响音量控制不佳。随后增加巡逻，并在晚9时劝导散场。',
    check: '看宝民一路附近房源，可选19至21时到朝广场的卧室听一听，也比较同一小区背向广场的楼栋。',
    source: '深圳市生态环境局 · 中央生态环境保护督察第八批，件号 X3GD202605160058',
    url: 'https://meeb.sz.gov.cn/attachment/1/1716/1716876/12806595.pdf',
  }
];

// One pictogram and one category per event across map, legend and place cards.
const atlasEventTypes={
  works:{label:'施工绕行',color:'#efb677',icon:'<path d="M-8 -4H8V2H-8ZM-5 2V7M5 2V7M-6 0l3-4M0 0l3-4M6 0l2-3"/>'},
  air:{label:'工业气味',color:'#b7c98c',icon:'<path d="M-8 6V-1l5 2v-4l6 3v-5h3l1 11ZM3-8q-2-2 1-3m1 3q3-1 3-3"/>'},
  rail:{label:'轨道噪声',color:'#b5aceb',icon:'<rect x="-8" y="-7" width="9" height="12" rx="2"/><path d="M-7-3H0M-6 7l2-2m4 2-2-2M4-3q4 3 0 6m3-9q7 6 0 12"/>'},
  flight:{label:'航空噪声',color:'#94cfeb',icon:'<path d="M0-9c1 0 1.5 1.2 1.5 3.2V-2L8 3v2L1.5 2.2v3.5L4 8v1L0 7.5-4 9V8l2.5-2.3V2.2L-8 5V3l6.5-5v-3.8C-1.5-7.8-1-9 0-9Z" fill="currentColor" stroke="none"/>'},
  crowd:{label:'枢纽客流',color:'#e7cf86',icon:'<circle cx="-2" cy="-4.5" r="2.6"/><path d="M-8 6V4a6 6 0 0 1 12 0v2ZM4-6a2.5 2.5 0 0 1 0 5m2 2q3 .5 3 5"/>'},
  noise:{label:'生活噪声',color:'#e5959f',icon:'<path d="M-8-3h4l5-4V7l-5-4h-4ZM4-3q3 3 0 6m3-9q6 6 0 12"/>'},
  note:{label:'我的观察',color:'#c9acd9',icon:'<path d="M-6 7l1-5 9-10 4 4-9 10ZM-5 2l4 4"/>'}
};
function atlasEventType(e){
  if(e.personal)return 'note';
  return ({'施工绕行':'works','工业废气':'air','工业异味':'air','轨道噪声':'rail','机场运行':'flight','铁路枢纽':'crowd','生活噪声':'noise'})[e.kind]||'note';
}
function atlasEventGlyph(type){
  const t=atlasEventTypes[type];
  return '<g aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="color:'+t.color+'">'+t.icon+'</g>';
}
function atlasEventIcon(type){
  return '<svg class="event-icon" viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">'+atlasEventGlyph(type)+'</svg>';
}
function atlasEventMarker(e,x,y,active,esc,action='ev',offset=[0,0]){
  const type=atlasEventType(e),title=esc(atlasEventTypes[type].label+' · '+e.name),[dx,dy]=offset;
  const lead=dx||dy?'<path d="M'+(-dx)+' '+(-dy)+'L0 0" stroke="'+atlasEventTypes[type].color+'" stroke-width="1" pointer-events="none"/>':'';
  return '<g class="map-marker event-marker" data-event-type="'+type+'" data-'+action+'="'+esc(e.id)+'" aria-label="'+title+'" role="button" tabindex="0" transform="translate('+(x+dx)+' '+(y+dy)+')"><title>'+title+'</title>'+lead+'<circle class="marker-hit" r="12" fill="#173039" stroke="'+(active?'#fff2ba':atlasEventTypes[type].color)+'" stroke-width="'+(active?2.5:1)+'"/>'+atlasEventGlyph(type)+'</g>';
}
