'use strict';
let token = '';
const $ = id => document.getElementById(id);
const output = obj => { $('output').textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); };
const message = text => { output(text); };
async function api(path, body) {
  const options = {method:body === undefined?'GET':'POST',headers:{'X-RedLab-Token':token}};
  if(body !== undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  const response = await fetch('/api/'+path,options);
  const result = await response.json();
  if(!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
async function run(callback) {try{await callback();}catch(error){message('ERROR: '+error.message);}}
function renderTargets(targets) {
  $('targets-count').textContent=String(targets.length);
  const list=$('targets');list.replaceChildren();
  const selects=[$('probe-host'),$('board-host')];
  selects.forEach(select=>{const selected=select.value;select.replaceChildren(new Option('Select a target',''));targets.forEach(host=>select.add(new Option(host,host)));select.value=targets.includes(selected)?selected:'';});
  if(!targets.length){const small=document.createElement('small');small.textContent='No authorized targets yet.';list.append(small);return;}
  targets.forEach(host=>{const tag=document.createElement('div');tag.className='tag';
    const label=document.createElement('span');label.textContent=host;
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+host);
    remove.addEventListener('click',()=>run(async()=>{const v=await api('targets/remove',{host});renderTargets(v.targets);await refreshEvents();}));
    tag.append(label,remove);list.append(tag);});
}
async function refreshEvents(){const result=await api('events');const holder=$('events');holder.replaceChildren();
  if(!result.events.length){const empty=document.createElement('small');empty.textContent='No activity yet.';holder.append(empty);return;}
  result.events.slice().reverse().forEach(event=>{const box=document.createElement('div');box.className='event';
    const title=document.createElement('strong');title.textContent=String(event.type || 'activity').replaceAll('_',' ').toUpperCase();
    const time=document.createElement('time');time.textContent=String(event.time || '');
    const detail=document.createElement('span');const d=event.details || {};detail.textContent=d.host?('Target: '+d.host):'Scope and audit activity';
    box.append(title,time,detail);holder.append(box);});
}
async function refresh(){const [status,targets]=await Promise.all([api('status'),api('targets')]);
  $('runtime').textContent='PYTHON 3';renderTargets(targets.targets);await refreshEvents();
  $('link-status').textContent='CONNECTED';$('link-status').classList.add('online');
  return status;
}
$('connect').addEventListener('click',()=>run(async()=>{token=$('token').value.trim();if(!token)throw new Error('Session token required');await refresh();$('token').value='';message('Authenticated to local RedLab OS.\nAll testing remains disabled until a target is explicitly authorized.');}));
$('add-target').addEventListener('click',()=>run(async()=>{const host=$('host').value.trim();const authorized=$('authorized').checked;if(!authorized)throw new Error('Confirm authorized ownership before adding scope');
  const result=await api('targets',{host,authorized});renderTargets(result.targets);$('authorized').checked=false;$('host').value='';await refreshEvents();message('Authorized scope updated.');}));
$('probe').addEventListener('click',()=>run(async()=>{const host=$('probe-host').value;const values=$('ports').value.split(',').map(s=>s.trim());if(!host)throw new Error('Select an authorized target');
  if(values.some(v=>!/^\d+$/.test(v)) || values.length>12)throw new Error('Provide up to 12 individual numeric ports separated by commas');
  const result=await api('probe',{host,ports:values.map(Number)});output(result);await refreshEvents();}));
$('board').addEventListener('click',()=>run(async()=>{const host=$('board-host').value;if(!host)throw new Error('Select an authorized board');
  output(await api('board',{host,command:$('board-command').value}));await refreshEvents();}));
$('analyze').addEventListener('click',()=>run(async()=>output(await api('analyze',{use_model:false}))));
$('llm').addEventListener('click',()=>run(async()=>output(await api('analyze',{use_model:true}))));
$('report').addEventListener('click',()=>run(async()=>{const report=await api('report');const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='evil-redlab-report.json';a.click();URL.revokeObjectURL(url);message('JSON report generated from recorded TCP connect observations.');}));
$('refresh').addEventListener('click',()=>run(refreshEvents));
$('clear-output').addEventListener('click',()=>message('Console cleared.'));
