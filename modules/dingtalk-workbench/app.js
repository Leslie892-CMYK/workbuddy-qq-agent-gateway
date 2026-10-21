const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get("token") || sessionStorage.getItem("dingToken");
if (token) sessionStorage.setItem("dingToken", token);
if (location.hash) history.replaceState(null, "", location.pathname);
let state = null, sheet = null, filename = "", campaign = null;
const labels = { week:"周次", date:"日期", time:"时间段", campus:"校区", course:"课程", className:"班级", teacher:"授课教师", room:"教室", location:"地点", note:"备注" };
const patterns = {week:/周次|周数/,date:/日期|授课日期|上课日期/,time:/时间|节次|课时/,campus:/校区/,course:/课程|科目|教学内容/,className:/班级|年级/,teacher:/教师|老师|主讲/,room:/教室|场地/,location:/地点|授课地点/,note:/备注|说明/};
const escape = (value) => String(value??"").replace(/[&<>"']/g, (s) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[s]);
async function api(url, options={}) {
  const response = await fetch(url, { ...options, headers:{ authorization:`Bearer ${token}`, ...(options.headers||{}) } });
  const type=response.headers.get("content-type")||"";
  const value=type.includes("json")?await response.json():await response.blob();
  if (!response.ok) throw new Error(value.error||`HTTP ${response.status}`);
  return value;
}
async function refresh() {
  state=await api("/api/state");
  if (!$("skip").value) $("skip").value=(state.preferences?.skipTeachers||[]).join("、");
  campaign=state.campaigns[0]||null;
  renderCampaign(); renderConversations();
  $("status").textContent="已连接本机工作台";
  await refreshHealth();
}
async function refreshHealth(){
  try{const health=await api("/api/health");$("health").innerHTML=`本机服务运行 ${health.uptimeSeconds} 秒 · ${health.conversations} 个会话 · ${health.campaigns} 份通知<br>钉钉：${health.desktop.running?"已运行":"未检测到"}；辅助功能：${health.desktop.trusted?"已授权":"尚未授权"}${health.desktop.error?` · ${escape(health.desktop.error)}`:""}`;}
  catch(e){$("health").textContent=e.message;}
}
function message(text, ok=false) { $("status").textContent=text; $("status").style.color=ok?"#267647":"#a43b26"; }
function columnOptions() {
  const index=Number($("headerIndex")?.value||0);
  const headers=sheet.rows[index]||[];
  $("columnMap").innerHTML=Object.entries(labels).map(([key,label])=>{
    const selected=headers.findIndex((header)=>patterns[key].test(String(header)));
    return `<label>${label}<select id="column-${key}"><option value="">不使用</option>${headers.map((header,i)=>`<option value="${i}" ${selected===i?"selected":""}>${escape(header||`第${i+1}列`)}</option>`).join("")}</select></label>`;
  }).join("");
}
$("xlsx").addEventListener("change",async(event)=>{
  try {
    const file=event.target.files[0]; if(!file)return;
    filename=file.name; sheet=await api("/api/import",{method:"POST",headers:{"content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},body:await file.arrayBuffer()});
    const candidate=sheet.rows.findIndex((row)=>row.some((value)=>/教师|老师/.test(String(value)))&&row.some((value)=>/课程|日期|时间/.test(String(value))));
    $("sheet").innerHTML=`已读取 ${escape(sheet.sheet)} 表，共 ${sheet.rows.length} 行。标题行：<select id="headerIndex">${sheet.rows.slice(0,15).map((row,i)=>`<option value="${i}" ${i===(candidate>=0?candidate:0)?"selected":""}>第${i+1}行 · ${escape(row.slice(0,4).join(" / "))}</option>`).join("")}</select>`;
    $("headerIndex").addEventListener("change",columnOptions);
    $("mapping").hidden=false; columnOptions(); message("课表已导入",true);
  } catch(error){message(error.message);}
});
$("create").addEventListener("click",async()=>{
  try {
    const columns=Object.fromEntries(Object.keys(labels).map((key)=>[key,$(`column-${key}`).value]).filter(([,value])=>value!==""));
    const rows=sheet.rows.slice(Number($("headerIndex").value)+1);
    const input={ rows, columns, weekLabel:$("week").value.trim(), campus:$("campus").value.trim(),
      skipTeachers:$("skip").value.split(/[，,、]/).map(s=>s.trim()).filter(Boolean), sourceName:filename,
      replaceId:campaign?.id||null };
    campaign=await api("/api/campaigns",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    await refresh(); message("授课通知预览已生成，请逐项核对",true);
  }catch(error){message(error.message);}
});
function renderCampaign(){
  if(!campaign){$("campaign").innerHTML="<p>导入课表并生成预览后，在这里核对内容。</p>";return;}
  $("campaignState").textContent=campaign.approvedFingerprint===campaign.fingerprint?"已批准当前版本":"待核对";
  const changes=campaign.changes.length?`<div class="notice">检测到 ${campaign.changes.length} 项调课或变化。旧批准已撤销，请复核。</div>`:"";
  const missing=campaign.lessons.filter(x=>!x.room&&!x.location||!x.className).length;
  $("campaign").innerHTML=`${changes}${missing?`<p class="notice">${missing} 条课程缺少班级或地点，请确认原表。</p>`:""}
    <p class="meta">来源：${escape(campaign.sourceName)} · ${campaign.lessons.length} 节课 · ${campaign.personalDrafts.length} 位老师 · 排除个人通知：${escape(campaign.excludedTeachers.join("、"))}</p>
    <h3>群内通知草稿</h3><div class="draft">${escape(campaign.group.text)}</div><button class="secondary" data-copy="group" ${campaign.approvedFingerprint!==campaign.fingerprint?"disabled":""}>复制已批准的群通知</button>
    <h3 style="margin-top:18px">逐位通知草稿</h3>${campaign.personalDrafts.map((d,i)=>`<div class="teacher"><strong>${escape(d.teacher)}</strong><div class="draft">${escape(d.text)}</div><button class="secondary" data-copy="${i}" ${campaign.approvedFingerprint!==campaign.fingerprint?"disabled":""}>复制已批准的个人通知</button><label>次日已读核对<select data-read-teacher="${escape(d.teacher)}"><option value="">待核对</option><option value="read" ${campaign.readChecks.find(x=>x.teacher===d.teacher)?.status==="read"?"selected":""}>已读</option><option value="unread" ${campaign.readChecks.find(x=>x.teacher===d.teacher)?.status==="unread"?"selected":""}>未读，需语音或电话联系</option><option value="contacted" ${campaign.readChecks.find(x=>x.teacher===d.teacher)?.status==="contacted"?"selected":""}>已人工联系</option></select></label></div>`).join("")}
    <div class="row" style="margin-top:18px"><button id="approve" ${missing||campaign.approvedFingerprint===campaign.fingerprint?"disabled":""}>批准这批草稿</button><button id="review" class="secondary">让 WorkBuddy 复核</button><button id="roster" class="secondary">下载授课名单图片</button><button id="calendar" class="secondary">下载周一、周二日历提醒</button></div>
    ${campaign.agentReview?.fingerprint===campaign.fingerprint?`<h3 style="margin-top:18px">智能体复核意见</h3><div class="draft">${escape(campaign.agentReview.text)}</div>`:""}
    <p class="meta">批准仅保存审核记录，不会向钉钉发送消息。发送前还需在钉钉中核对实际收件人和内容。</p>`;
  $("approve").onclick=async()=>{try{campaign=await api(`/api/campaigns/${campaign.id}/approve`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fingerprint:campaign.fingerprint})});renderCampaign();message("当前版本已批准",true);}catch(e){message(e.message);}};
  $("review").onclick=async()=>{const button=$("review");button.disabled=true;message("WorkBuddy 正在复核…",true);try{await api(`/api/campaigns/${campaign.id}/review`,{method:"POST"});await refresh();message("复核完成",true);}catch(e){message(e.message);}finally{button.disabled=false;}};
  $("campaign").querySelectorAll("select[data-read-teacher]").forEach(select=>select.onchange=async()=>{
    if(!select.value)return;
    try{await api(`/api/campaigns/${campaign.id}/read-check`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({teacher:select.dataset.readTeacher,status:select.value})});message("已读核对已保存",true);}catch(e){message(e.message);}
  });
  $("campaign").querySelectorAll("button[data-copy]").forEach(button=>button.onclick=async()=>{
    const target=button.dataset.copy;
    const text=target==="group"?campaign.group.text:campaign.personalDrafts[Number(target)]?.text;
    if(!text||campaign.approvedFingerprint!==campaign.fingerprint)return;
    try{await navigator.clipboard.writeText(text);message("已复制，请在钉钉核对收件人后手动发送",true);}catch(e){message(`复制失败：${e.message}`);}
  });
  $("roster").onclick=()=>downloadRoster(campaign);
  $("calendar").onclick=async()=>{try{const file=await api(`/api/campaigns/${campaign.id}/calendar`);const link=document.createElement("a");link.href=URL.createObjectURL(file);link.download="授课通知提醒.ics";link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}catch(e){message(e.message);}};
}
function downloadRoster(batch){
  const width=1450, line=44, rows=batch.lessons, height=Math.max(280,180+rows.length*line);
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);
  ctx.fillStyle="#17334c";ctx.font="bold 32px PingFang SC, sans-serif";ctx.fillText(batch.title,42,60);
  const names=["日期","时间","课程","班级","授课教师","场地"];
  const x=[42,210,400,725,1000,1190];
  ctx.fillStyle="#e9f3f8";ctx.fillRect(28,92,width-56,54);
  ctx.fillStyle="#17334c";ctx.font="bold 20px PingFang SC, sans-serif";names.forEach((name,i)=>ctx.fillText(name,x[i],126));
  ctx.font="19px PingFang SC, sans-serif";
  rows.forEach((row,i)=>{const y=185+i*line;if(i%2){ctx.fillStyle="#f6f9fb";ctx.fillRect(28,y-29,width-56,line);}ctx.fillStyle="#243c4a";
    [row.date,row.time,row.course,row.className,row.teacher,row.room||row.location].forEach((value,j)=>ctx.fillText(String(value||"—").slice(0,j===2?18:14),x[j],y));});
  const link=document.createElement("a");link.href=canvas.toDataURL("image/png");link.download="授课名单.png";link.click();
}
async function captureCurrent(){
  try{const name=$("conversationName").value.trim();if(!name)throw new Error("请输入当前聊天名称");
    const result=await api("/api/capture",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
    $("captureResult").textContent=`读取 ${result.visibleCount} 条可见文字，新增 ${result.added} 条。`;
    await refresh();
  }catch(error){$("captureResult").textContent=error.message;message(error.message);}
}
$("capture").onclick=captureCurrent;
setInterval(()=>{if($("autoCapture").checked&&$("conversationName").value.trim())captureCurrent();},15000);
function renderConversations(){
  const chats=Object.values(state.conversations||{});
  $("conversations").innerHTML=chats.length?chats.map(chat=>`<article><div class="row"><strong>${escape(chat.id)}</strong><span class="meta">${chat.messages.length} 条记录</span><select data-chat="${escape(chat.id)}" data-type><option value="group" ${chat.type==="group"?"selected":""}>群聊</option><option value="private" ${chat.type==="private"?"selected":""}>私聊</option></select></div>
    <label>会话启用 <input type="checkbox" data-chat="${escape(chat.id)}" data-key="enabled" ${chat.enabled?"checked":""}></label>
    <div class="row">${Object.entries(chat.permissions).map(([key,value])=>`<label>${escape({notifications:"通知",calendar:"日历",files:"文件",stickers:"表情",home:"智能家居"}[key])}<input type="checkbox" data-chat="${escape(chat.id)}" data-key="${key}" ${value?"checked":""}></label>`).join("")}</div>
    ${chat.type==="private"?`<label>主动关联群聊上下文（私聊内容可能影响群里的后续回答）<select data-chat="${escape(chat.id)}" data-link><option value="">不关联</option>${chats.filter(other=>other.type==="group").map(other=>`<option value="${escape(other.id)}" ${chat.sharedWith===other.id?"selected":""}>${escape(other.id)}</option>`).join("")}</select></label>`:""}
    <div class="row"><input data-chat="${escape(chat.id)}" data-prompt placeholder="让 WorkBuddy 整理通知或回答问题"><button data-chat="${escape(chat.id)}" data-ask>提问</button><button class="secondary" data-chat="${escape(chat.id)}" data-organize>整理通知</button></div><div class="row">${["👍","👌","😊","📌","⏰"].map(emoji=>`<button class="secondary" data-chat="${escape(chat.id)}" data-emoji="${emoji}">${emoji}</button>`).join("")}</div><p data-chat="${escape(chat.id)}" data-answer></p>
    <div class="row"><input type="file" data-chat="${escape(chat.id)}" data-upload-file><select data-chat="${escape(chat.id)}" data-upload-kind><option value="file">本地文件</option><option value="sticker">图片表情</option></select><button class="secondary" data-chat="${escape(chat.id)}" data-upload>保存到会话</button></div>
    <p class="meta">${(chat.files||[]).slice(0,8).map(file=>`${escape(file.kind==="sticker"?"表情":"文件")}：<a href="#" data-download="${file.id}">${escape(file.name)}</a>`).join(" · ")}</p>
    <details><summary>查看本地上下文</summary><pre>${escape(chat.messages.slice(-20).map(x=>x.text).join("\n"))}</pre></details></article>`).join(""):"<p>暂无已收集的会话。</p>";
  $("conversations").querySelectorAll("input[data-chat]").forEach(input=>input.onchange=async()=>{
    try{const id=encodeURIComponent(input.dataset.chat);const key=input.dataset.key;
      await api(`/api/conversations/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(key==="enabled"?{enabled:input.checked}:{permissions:{[key]:input.checked}})});
      message("会话设置已保存",true);
    }catch(e){input.checked=!input.checked;message(e.message);}
  });
  $("conversations").querySelectorAll("select[data-link]").forEach(select=>select.onchange=async()=>{
    try{await api(`/api/conversations/${encodeURIComponent(select.dataset.chat)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({sharedWith:select.value||null})});message("上下文关联已保存",true);}catch(e){message(e.message);}
  });
  $("conversations").querySelectorAll("select[data-type]").forEach(select=>select.onchange=async()=>{
    try{await api(`/api/conversations/${encodeURIComponent(select.dataset.chat)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({type:select.value})});await refresh();message("会话类型已保存",true);}catch(e){message(e.message);}
  });
  $("conversations").querySelectorAll("button[data-ask]").forEach(button=>button.onclick=async()=>{
    const id=button.dataset.chat;const input=[...$("conversations").querySelectorAll("input[data-prompt]")].find(x=>x.dataset.chat===id);
    const answer=[...$("conversations").querySelectorAll("p[data-answer]")].find(x=>x.dataset.chat===id);
    button.disabled=true;answer.textContent="WorkBuddy 正在处理…";
    try{const reply=await api("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:id,prompt:input.value})});answer.textContent=reply.text;}
    catch(e){answer.textContent=e.message;message(e.message);}finally{button.disabled=false;}
  });
  $("conversations").querySelectorAll("button[data-emoji]").forEach(button=>button.onclick=()=>{
    const input=[...$("conversations").querySelectorAll("input[data-prompt]")].find(x=>x.dataset.chat===button.dataset.chat);
    input.value+=button.dataset.emoji;input.focus();
  });
  $("conversations").querySelectorAll("button[data-organize]").forEach(button=>button.onclick=()=>{
    const id=button.dataset.chat;
    const input=[...$("conversations").querySelectorAll("input[data-prompt]")].find(x=>x.dataset.chat===id);
    input.value="请根据本会话最近的消息，整理需要我处理的通知：事项、截止时间、负责人、信息来源，以及仍需确认的内容。不要编造日期。";
    [...$("conversations").querySelectorAll("button[data-ask]")].find(x=>x.dataset.chat===id).click();
  });
  $("conversations").querySelectorAll("button[data-upload]").forEach(button=>button.onclick=async()=>{
    const id=button.dataset.chat;
    const fileInput=[...$("conversations").querySelectorAll("input[data-upload-file]")].find(x=>x.dataset.chat===id);
    const kind=[...$("conversations").querySelectorAll("select[data-upload-kind]")].find(x=>x.dataset.chat===id).value;
    const file=fileInput.files[0];if(!file){message("请先选择文件");return;}
    try{await api(`/api/conversations/${encodeURIComponent(id)}/attachments`,{method:"POST",headers:{"content-type":file.type||"application/octet-stream","x-file-name":encodeURIComponent(file.name),"x-attachment-kind":kind},body:await file.arrayBuffer()});await refresh();message("文件已保存到本地会话",true);}catch(e){message(e.message);}
  });
  $("conversations").querySelectorAll("a[data-download]").forEach(link=>link.onclick=async(event)=>{
    event.preventDefault();try{const blob=await api(`/api/attachments/${link.dataset.download}`);const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=link.textContent;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}catch(e){message(e.message);}
  });
}
refresh().catch(e=>message(e.message));
setInterval(refreshHealth,30000);
