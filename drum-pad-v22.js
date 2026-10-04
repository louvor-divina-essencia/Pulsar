/* PULSAR Drum Pad 2.2 — premium transport, long-sample control and import hub */
(()=>{
  'use strict';
  const VERSION='2.2';
  const MODE_LABELS={oneshot:'ONE SHOT',toggle:'TOGGLE',loop:'LOOP',hold:'HOLD'};
  const padVoices=new Map();
  const toggleVoices=new Map();
  const startTokens=new Map();
  let importPlan={target:'current',bankName:'',mode:'auto'};

  function safeMode(v){return ['oneshot','toggle','loop','hold'].includes(v)?v:'oneshot'}
  function inferMode(name='',duration=0){
    const s=String(name).toLowerCase();
    if(/(^|[\s._-])(loop|arp|arpej|arpeggio|sequence|sequencia|seq|ambient|atmos|riser)([\s._-]|$)/i.test(s))return 'toggle';
    const d=Number(duration)||0;
    const seconds=d>1000?d/1000:d;
    return seconds>=6?'toggle':'oneshot'
  }
  function modeForImport(file){return importPlan.mode==='auto'?inferMode(file?.name,file?.duration):safeMode(importPlan.mode)}
  function migrateModes(){
    let changed=false;
    const groups=[state.pads||[],...(state.drumBanks||[]).map(b=>b.pads||[])];
    for(const pads of groups)for(const p of pads){if(!p.playMode){p.playMode=inferMode(p.fileName||p.name);changed=true}}
    if(changed)save()
  }
  migrateModes();

  function injectStyles(){
    if(document.getElementById('pulsarDrum22Style'))return;
    const style=document.createElement('style');style.id='pulsarDrum22Style';style.textContent=`
      #drums .page-title{margin-bottom:14px}
      .drum22-console{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(250px,.65fr);gap:12px;margin:12px 0 14px}
      .drum22-transport,.drum22-live{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.08);border-radius:24px;background:linear-gradient(145deg,rgba(20,27,47,.96),rgba(8,11,22,.96));box-shadow:0 20px 55px rgba(0,0,0,.22),inset 0 1px rgba(255,255,255,.045);padding:16px}
      .drum22-transport:before{content:"";position:absolute;inset:-70% 42% auto -15%;height:180px;background:radial-gradient(circle,rgba(55,231,255,.16),transparent 68%);pointer-events:none}
      .drum22-kicker{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:13px}.drum22-kicker small,.drum22-live small{font-size:9px;font-weight:900;letter-spacing:.16em;color:#8e98b5}.drum22-kicker span{font-size:9px;font-weight:900;letter-spacing:.12em;color:#48e6a7;border:1px solid rgba(72,230,167,.2);background:rgba(72,230,167,.06);padding:6px 9px;border-radius:999px}
      .drum22-bpm{display:grid;grid-template-columns:48px 1fr 48px;align-items:center;gap:10px}.drum22-bpm button{height:48px;border-radius:15px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.04);color:#f7f8ff;font-size:24px}.drum22-bpm-main{text-align:center;display:flex;align-items:baseline;justify-content:center;gap:7px}.drum22-bpm-main b{font-size:clamp(36px,8vw,58px);line-height:.9;letter-spacing:-.06em;color:#37e7ff}.drum22-bpm-main em{font-style:normal;font-size:10px;font-weight:900;letter-spacing:.15em;color:#8e98b5}
      .drum22-sync-line{display:flex;gap:8px;align-items:center;margin-top:13px;flex-wrap:wrap}.drum22-sync-line button{border:1px solid rgba(55,231,255,.18);background:rgba(55,231,255,.06);color:#c9f9ff;border-radius:12px;padding:9px 11px;font-size:10px;font-weight:900;letter-spacing:.08em}.drum22-sync-line span{margin-left:auto;color:#8e98b5;font-size:10px}
      .drum22-live{display:flex;flex-direction:column;justify-content:space-between}.drum22-live-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.drum22-live-head b{font-size:1.12rem;letter-spacing:-.02em}.drum22-live-count{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:rgba(140,108,255,.10);border:1px solid rgba(140,108,255,.22);color:#bbaaff;font-weight:900}.drum22-stop{width:100%;margin-top:18px;border:1px solid rgba(255,85,112,.24);background:linear-gradient(135deg,rgba(255,85,112,.15),rgba(255,85,112,.065));color:#ff8ea2;border-radius:15px;min-height:46px;font-weight:950;letter-spacing:.09em}.drum22-status{margin-top:9px;display:flex;align-items:center;gap:8px;color:#8e98b5;font-size:10px}.drum22-status i{width:7px;height:7px;border-radius:50%;background:#48e6a7;box-shadow:0 0 12px rgba(72,230,167,.6)}
      #drums .drum-master{margin-top:0!important}.drum-sync-v14{border:1px solid rgba(255,255,255,.08)!important;background:rgba(10,14,26,.72)!important;border-radius:20px!important;padding:12px!important}.drum-loop-help{border:1px solid rgba(55,231,255,.10);background:rgba(55,231,255,.035);border-radius:14px;padding:10px 12px!important;color:#9aa8c4!important}
      .drum-pad{overflow:hidden;isolation:isolate;transition:transform .12s ease,border-color .18s ease,box-shadow .18s ease,filter .18s ease!important}.drum-pad:after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,transparent,var(--pad),transparent);opacity:.35;transition:opacity .18s ease,box-shadow .18s ease}.drum-pad.playing,.drum-pad.looping{border-color:color-mix(in srgb,var(--pad) 70%,#fff 8%)!important;box-shadow:0 0 0 1px color-mix(in srgb,var(--pad) 22%,transparent),0 18px 45px color-mix(in srgb,var(--pad) 15%,transparent)!important}.drum-pad.playing:after,.drum-pad.looping:after{opacity:1;box-shadow:0 0 22px var(--pad)}
      .drum22-mode{position:absolute;left:14px;top:13px;z-index:3;pointer-events:none;border:1px solid rgba(255,255,255,.09);background:rgba(5,8,17,.72);backdrop-filter:blur(8px);border-radius:999px;padding:5px 8px;font-size:8px;font-weight:950;letter-spacing:.11em;color:#aebbd2}.drum-pad.playing .drum22-mode{color:#fff;border-color:color-mix(in srgb,var(--pad) 42%,transparent)}
      .drum-pad>b{display:block;padding:44px 44px 0 14px!important;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.drum-pad .pad-file-name{display:block;padding:5px 14px 0!important;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.drum-pad .level-tag{bottom:12px!important;right:13px!important}.pad-repeat-button{top:10px!important;right:10px!important}.pad-repeat-button.active{box-shadow:0 0 22px color-mix(in srgb,var(--pad) 24%,transparent)}
      .drum22-hold-hint{position:absolute;left:14px;bottom:12px;font-size:8px;color:#8e98b5;font-weight:900;letter-spacing:.08em}
      .drum22-editor-mode{display:block;margin-top:12px}.drum22-editor-mode>span{display:flex;justify-content:space-between;gap:12px;margin-bottom:7px;font-size:10px;font-weight:900;letter-spacing:.08em;color:#9babbe}.drum22-editor-mode select{width:100%;border:1px solid rgba(255,255,255,.1);background:#09111c;color:#fff;border-radius:12px;padding:13px}.drum22-editor-mode small{display:block;margin-top:7px;color:#7f8da8;font-size:10px;line-height:1.45}
      .drum22-import{width:min(92vw,560px);border:1px solid rgba(255,255,255,.1);border-radius:26px;background:#080b16;color:#f7f8ff;padding:0;box-shadow:0 35px 100px #000a}.drum22-import::backdrop{background:rgba(2,4,10,.78);backdrop-filter:blur(10px)}.drum22-import-card{padding:20px}.drum22-import-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.drum22-import-head small{color:#37e7ff;font-size:9px;font-weight:900;letter-spacing:.17em}.drum22-import-head h3{margin:4px 0 3px;font-size:1.5rem;letter-spacing:-.04em}.drum22-import-head p{margin:0;color:#8e98b5;font-size:11px}.drum22-import-head button{width:38px;height:38px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#fff;font-size:20px}.drum22-import-section{margin-top:16px;border:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.025);border-radius:18px;padding:13px}.drum22-import-section>small{display:block;color:#8e98b5;font-size:9px;font-weight:900;letter-spacing:.14em;margin-bottom:9px}.drum22-choice{display:grid;grid-template-columns:1fr 1fr;gap:8px}.drum22-choice button{min-height:44px;border-radius:13px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);color:#cbd5e8;font-size:10px;font-weight:900}.drum22-choice button.active{border-color:rgba(55,231,255,.38);background:linear-gradient(135deg,rgba(55,231,255,.11),rgba(140,108,255,.08));color:#fff}.drum22-import-section input{width:100%;margin-top:9px;border:1px solid rgba(255,255,255,.08);background:#070a13;color:#fff;border-radius:12px;padding:11px}.drum22-mode-grid{grid-template-columns:repeat(4,1fr)}.drum22-mode-grid button{padding:8px 4px}.drum22-import-note{color:#8e98b5;font-size:10px;line-height:1.45;margin:9px 0 0}.drum22-import-progress{margin-top:14px}.drum22-import-progress div{display:flex;justify-content:space-between;gap:12px;color:#9eabc3;font-size:10px;margin-bottom:7px}.drum22-import-progress>span{display:block;height:5px;border-radius:999px;background:#ffffff0d;overflow:hidden}.drum22-import-progress i{display:block;width:0;height:100%;background:linear-gradient(90deg,#37e7ff,#8c6cff);transition:width .2s ease}.drum22-import-action{width:100%;margin-top:15px;min-height:52px;border:0;border-radius:15px;background:linear-gradient(135deg,#37e7ff,#78e8c1);color:#061019;font-weight:950;letter-spacing:.08em}.drum22-import-action:disabled{opacity:.5}
      @media(max-width:680px){.drum22-console{grid-template-columns:1fr}.drum22-live{min-height:128px}.drum22-mode-grid{grid-template-columns:1fr 1fr}.drum-pad>b{padding-top:43px!important}.drum22-mode{left:11px;top:10px}.drum22-hold-hint{left:11px}.drum22-import-card{padding:16px}}
      @media(orientation:landscape) and (max-height:650px){.drum22-console{grid-template-columns:1.25fr .75fr;margin-top:5px}.drum22-transport,.drum22-live{padding:11px}.drum22-bpm-main b{font-size:38px}.drum22-stop{margin-top:8px;min-height:38px}.drum22-kicker{margin-bottom:8px}.drum22-sync-line{margin-top:8px}}
    `;document.head.appendChild(style)
  }

  function addVoice(i,voice){if(!padVoices.has(i))padVoices.set(i,new Set());padVoices.get(i).add(voice);refreshPadState(i)}
  function removeVoice(i,voice){let set=padVoices.get(i);if(set){set.delete(voice);if(!set.size)padVoices.delete(i)}if(toggleVoices.get(i)===voice)toggleVoices.delete(i);refreshPadState(i)}
  function refreshPadState(i){let el=document.querySelector(`.drum-pad[data-i="${i}"]`);if(el)el.classList.toggle('playing',!!padVoices.get(i)?.size);refreshStatus()}
  function fadeStopVoice(i,voice,at=null){
    if(!voice)return;const c=ctx(),when=Math.max(c.currentTime,at??c.currentTime),fade=.035;
    try{voice.gain.gain.cancelScheduledValues(when);voice.gain.gain.setValueAtTime(Math.max(.0001,voice.gain.gain.value||voice.level||1),when);voice.gain.gain.linearRampToValueAtTime(.0001,when+fade);voice.source.stop(when+fade+.01)}catch{try{voice.source.stop()}catch{}}
    if(!at||when<=c.currentTime+.06)removeVoice(i,voice)
  }
  function stopPadVoices(i,at=null){for(const voice of [...(padVoices.get(i)||[])])fadeStopVoice(i,voice,at);toggleVoices.delete(i)}
  function stopAllVoices(){for(const i of [...padVoices.keys()])stopPadVoices(i)}

  async function spawnVoice(i,el,{loop=false,when=null,exclusive=false,token=null}={}){
    let p=state.pads[i];if(!p)return null;
    if(p.driveRelativePath&&!p.nativeFileUri&&!p.audioKey&&!p.buffer){toast('Este som está na nuvem. Baixe o banco para tocar sem atraso.');openDriveFor('Drums');return null}
    const c=ctx();
    try{
      let buffer=await decodedForPad(i,p);if(!buffer)return null;
      if(token!=null&&startTokens.get(i)!==token)return null;
      const startAt=Math.max(c.currentTime+.005,when??c.currentTime+.008);
      if(exclusive)stopPadVoices(i,startAt);
      let source=c.createBufferSource(),gain=c.createGain();source.buffer=buffer;source.loop=!!loop;const level=+document.querySelector('#drumVolume').value*(p.volume??1);gain.gain.setValueAtTime(Math.max(.0001,level),startAt);connectDrum(gain);source.connect(gain);
      const voice={source,gain,level,startedAt:startAt,loop};addVoice(i,voice);source.onended=()=>removeVoice(i,voice);source.start(startAt);
      if(el){const delay=Math.max(0,(startAt-c.currentTime)*1000);setTimeout(()=>{el.classList.add('hit');setTimeout(()=>el.classList.remove('hit'),110)},delay)}
      return voice
    }catch(error){console.error('Drum 2.2 play error',error);toast('Este arquivo não pôde ser tocado');return null}
  }

  async function premiumHit(i,el){
    const p=state.pads[i];if(!p)return;const mode=safeMode(p.playMode);
    if(mode==='toggle'||mode==='loop'){
      if(toggleVoices.has(i)){startTokens.set(i,(startTokens.get(i)||0)+1);stopPadVoices(i);return}
      const token=(startTokens.get(i)||0)+1;startTokens.set(i,token);const voice=await spawnVoice(i,el,{loop:mode==='loop',exclusive:true,token});if(voice&&startTokens.get(i)===token)toggleVoices.set(i,voice);return
    }
    if(mode==='hold')return;
    await spawnVoice(i,el,{loop:false,exclusive:false})
  }

  function quantizedStart(){
    const c=ctx();
    if(metroTimer&&Number.isFinite(nextNoteTime)&&nextNoteTime>c.currentTime)return nextNoteTime;
    return c.currentTime+.03
  }
  function repeatInterval(rate=1){return Math.max(.04,60/Math.max(30,+bpm||120)*Math.max(.25,+rate||1))}
  async function scheduleRepeatTick(i,loop,el){
    if(drumLoops.get(i)!==loop)return;
    const c=ctx(),now=c.currentTime;
    if(loop.nextTime<now+.02)loop.nextTime=now+.025;
    const token=loop.token;
    await spawnVoice(i,el,{loop:false,when:loop.nextTime,exclusive:true,token});
    if(drumLoops.get(i)!==loop||loop.token!==token)return;
    loop.rate=+state.drumLoopRate||1;loop.nextTime+=repeatInterval(loop.rate);
    const delay=Math.max(12,(loop.nextTime-c.currentTime-.075)*1000);
    loop.timer=setTimeout(()=>scheduleRepeatTick(i,loop,el),delay)
  }

  const coreStopDrumLoop=stopDrumLoop;
  stopDrumLoop=function(i){
    const loop=drumLoops.get(i);if(loop?.premium){loop.token++;if(loop.timer)clearTimeout(loop.timer);stopPadVoices(i)}
    coreStopDrumLoop(i);refreshPadState(i);refreshStatus()
  };
  toggleDrumLoop=async function(i,el){
    if(drumLoops.has(i)){stopDrumLoop(i);toast('Repetição parada');return}
    const p=state.pads[i];if(!p)return;
    const loop={premium:true,timer:null,rate:+state.drumLoopRate||1,nextTime:quantizedStart(),token:(startTokens.get(i)||0)+1};startTokens.set(i,loop.token);drumLoops.set(i,loop);
    el?.classList.add('looping');const btn=document.querySelector(`.pad-repeat-button[data-repeat="${i}"]`);btn?.classList.add('active');btn?.setAttribute('aria-pressed','true');
    refreshStatus();toast(`Repetição ${repeatRateLabel(loop.rate)} · ${bpm} BPM`);await scheduleRepeatTick(i,loop,el)
  };
  hitPad=premiumHit;

  const coreSetBpm=setBpm;
  setBpm=function(v){coreSetBpm(v);const large=document.querySelector('#drum22Bpm');if(large)large.textContent=bpm;refreshStatus()};

  function stopEverything(){
    for(const i of [...drumLoops.keys()])stopDrumLoop(i);stopAllVoices();for(const [i] of startTokens)startTokens.set(i,(startTokens.get(i)||0)+1);refreshStatus();toast('Todos os Drum Pads foram parados')
  }
  function activePadCount(){const ids=new Set([...padVoices.keys(),...drumLoops.keys()]);return ids.size}
  function refreshStatus(){
    const count=activePadCount(),countEl=document.querySelector('#drum22ActiveCount'),text=document.querySelector('#drum22StatusText'),sync=document.querySelector('#drum22SyncState'),large=document.querySelector('#drum22Bpm');
    if(countEl)countEl.textContent=count;if(text)text.textContent=count?`${count} pad${count===1?'':'s'} ativo${count===1?'':'s'}`:'Pronto para tocar';if(sync)sync.textContent=`${bpm} BPM · ${repeatRateLabel(state.drumLoopRate)} tempo${+state.drumLoopRate>1?'s':''}`;if(large)large.textContent=bpm
  }

  function injectConsole(){
    if(document.querySelector('.drum22-console'))return;
    const master=document.querySelector('#drums .drum-master');if(!master)return;
    const box=document.createElement('div');box.className='drum22-console';box.innerHTML=`
      <section class="drum22-transport"><div class="drum22-kicker"><small>DRUM ENGINE ${VERSION}</small><span>SYNC BPM</span></div><div class="drum22-bpm"><button id="drum22Minus" type="button">−</button><div class="drum22-bpm-main"><b id="drum22Bpm">${bpm}</b><em>BPM</em></div><button id="drum22Plus" type="button">＋</button></div><div class="drum22-sync-line"><button id="drum22Tap" type="button">TAP TEMPO</button><button id="drum22Restart" type="button">↻ RESSINCRONIZAR</button><span id="drum22SyncState"></span></div></section>
      <section class="drum22-live"><div><div class="drum22-live-head"><div><small>AO VIVO</small><b>Controle rápido</b></div><span class="drum22-live-count" id="drum22ActiveCount">0</span></div><div class="drum22-status"><i></i><span id="drum22StatusText">Pronto para tocar</span></div></div><button id="drum22StopAll" class="drum22-stop" type="button">■ PARAR TUDO</button></section>`;
    master.parentNode.insertBefore(box,master);
    document.querySelector('#drum22Minus').onclick=()=>setBpm(bpm-1);document.querySelector('#drum22Plus').onclick=()=>setBpm(bpm+1);document.querySelector('#drum22Tap').onclick=()=>{tapBpm();refreshStatus()};document.querySelector('#drum22StopAll').onclick=stopEverything;
    document.querySelector('#drum22Restart').onclick=()=>{for(const i of [...drumLoops.keys()]){const el=document.querySelector(`.drum-pad[data-i="${i}"]`);stopDrumLoop(i);setTimeout(()=>toggleDrumLoop(i,el),20)}toast('Repetições ressincronizadas')};refreshStatus()
  }

  function decoratePads(){
    document.querySelectorAll('.drum-pad').forEach(el=>{
      const i=+el.dataset.i,p=state.pads[i];if(!p)return;const mode=safeMode(p.playMode);let badge=el.querySelector('.drum22-mode');if(!badge){badge=document.createElement('span');badge.className='drum22-mode';el.appendChild(badge)}badge.textContent=MODE_LABELS[mode];
      el.querySelector('.drum22-hold-hint')?.remove();
      if(mode==='hold'){
        const hint=document.createElement('span');hint.className='drum22-hold-hint';hint.textContent='SEGURE PARA TOCAR';el.appendChild(hint);
        el.onclick=e=>{if(e.target.closest('button'))return;if(editingPads)return editPad(i);e.preventDefault()};
        el.onpointerdown=async e=>{if(editingPads||e.target.closest('button'))return;e.preventDefault();const token=(startTokens.get(i)||0)+1;startTokens.set(i,token);const voice=await spawnVoice(i,el,{exclusive:true,token});if(voice)toggleVoices.set(i,voice)};
        const release=e=>{if(editingPads||e.target.closest?.('button'))return;startTokens.set(i,(startTokens.get(i)||0)+1);stopPadVoices(i)};el.onpointerup=release;el.onpointercancel=release;el.onpointerleave=e=>{if(e.buttons)release(e)}
      }else{el.onpointerdown=null;el.onpointerup=null;el.onpointercancel=null;el.onpointerleave=null}
      el.classList.toggle('playing',!!padVoices.get(i)?.size)
    });refreshStatus()
  }

  const coreRenderDrums=renderDrums;
  renderDrums=function(){coreRenderDrums();decoratePads();refreshStatus()};

  function injectEditorMode(){
    const controls=document.querySelector('#padEditor .editor-controls');if(!controls||document.querySelector('#padPlayMode'))return;
    const field=document.createElement('label');field.className='drum22-editor-mode';field.innerHTML=`<span>MODO DE REPRODUÇÃO <b id="padPlayModeLabel">ONE SHOT</b></span><select id="padPlayMode"><option value="oneshot">One Shot · toca inteiro a cada toque</option><option value="toggle">Toggle · toque para iniciar / toque para parar</option><option value="loop">Loop · repete o arquivo até você parar</option><option value="hold">Hold · toca enquanto estiver segurando</option></select><small id="padPlayModeHelp">Ideal para bateria, efeitos e samples curtos.</small>`;controls.parentNode.insertBefore(field,controls);
    const sel=field.querySelector('select'),label=field.querySelector('#padPlayModeLabel'),help=field.querySelector('#padPlayModeHelp');
    const sync=()=>{const m=safeMode(sel.value);label.textContent=MODE_LABELS[m];help.textContent=m==='oneshot'?'Ideal para bateria, efeitos e samples curtos.':m==='toggle'?'Ideal para arpejadores e arquivos longos: toca uma vez e você pode parar no meio.':m==='loop'?'Mantém o arquivo em loop contínuo até você tocar novamente.':'O áudio só fica tocando enquanto o dedo estiver pressionando o pad.'};sel.onchange=sync;sync()
  }
  const coreEditPad=editPad;
  editPad=function(i){coreEditPad(i);injectEditorMode();const p=state.pads[i],sel=document.querySelector('#padPlayMode');if(sel){sel.value=safeMode(p?.playMode);sel.dispatchEvent(new Event('change'))}};
  injectEditorMode();
  const previewButton=document.querySelector('#previewPad');
  if(previewButton)previewButton.onclick=async()=>{
    if(previewSource){try{previewSource.stop()}catch{}previewSource=null;previewButton.textContent='▶ TESTAR';document.querySelector('.mini-meter')?.classList.remove('playing');return}
    try{let p=state.pads[editorIndex],raw=pendingBuffer||(pendingNativeFile?await nativePadRaw(pendingNativeFile.fileUri):await rawForPad(p));if(!raw)return toast('Escolha um arquivo de áudio primeiro');let c=ctx(),b=await c.decodeAudioData(raw.slice(0)),src=c.createBufferSource(),g=c.createGain();src.buffer=b;g.gain.value=+document.querySelector('#padVolume').value*+document.querySelector('#drumVolume').value;connectDrum(g);src.connect(g);src.start();previewSource=src;previewButton.textContent='■ PARAR TESTE';document.querySelector('.mini-meter')?.classList.add('playing');src.onended=()=>{if(previewSource===src)previewSource=null;previewButton.textContent='▶ TESTAR';document.querySelector('.mini-meter')?.classList.remove('playing')}}catch(error){console.error(error);toast('Formato de áudio não suportado neste aparelho')}
  };
  const savePadButton=document.querySelector('#savePad'),coreSavePad=savePadButton?.onclick;
  if(savePadButton&&coreSavePad)savePadButton.onclick=async e=>{let p=state.pads[editorIndex],sel=document.querySelector('#padPlayMode');if(p&&sel)p.playMode=safeMode(sel.value);await coreSavePad.call(savePadButton,e);renderDrums()};

  function injectImportDialog(){
    if(document.querySelector('#drum22ImportDialog'))return;
    const d=document.createElement('dialog');d.id='drum22ImportDialog';d.className='drum22-import';d.innerHTML=`<div class="drum22-import-card"><div class="drum22-import-head"><div><small>IMPORT HUB · DRUM 2.2</small><h3>Adicionar sons</h3><p>Importe vários arquivos e deixe o banco organizado desde o início.</p></div><button id="drum22ImportClose" type="button">×</button></div><section class="drum22-import-section"><small>DESTINO</small><div class="drum22-choice" id="drum22Target"><button class="active" data-target="current" type="button">BANCO ATUAL</button><button data-target="new" type="button">＋ NOVO BANCO</button></div><input id="drum22BankName" maxlength="24" placeholder="Nome do novo banco" hidden></section><section class="drum22-import-section"><small>MODO DOS NOVOS PADS</small><div class="drum22-choice drum22-mode-grid" id="drum22ImportMode"><button class="active" data-mode="auto" type="button">AUTO</button><button data-mode="oneshot" type="button">ONE SHOT</button><button data-mode="toggle" type="button">TOGGLE</button><button data-mode="loop" type="button">LOOP</button></div><p class="drum22-import-note">AUTO identifica nomes como ARP, ARPEJADOR, LOOP e SEQUENCE como sons longos; os demais entram como One Shot.</p></section><div class="drum22-import-progress" id="drum22ImportProgress" hidden><div><b id="drum22ImportText">Preparando…</b><span id="drum22ImportPct">0%</span></div><span><i id="drum22ImportBar"></i></span></div><button class="drum22-import-action" id="drum22ChooseFiles" type="button">＋ ESCOLHER ARQUIVOS</button></div>`;document.body.appendChild(d);
    d.querySelector('#drum22ImportClose').onclick=()=>d.close();d.addEventListener('cancel',e=>{e.preventDefault();d.close()});
    d.querySelectorAll('#drum22Target button').forEach(b=>b.onclick=()=>{d.querySelectorAll('#drum22Target button').forEach(x=>x.classList.toggle('active',x===b));importPlan.target=b.dataset.target;d.querySelector('#drum22BankName').hidden=importPlan.target!=='new'});
    d.querySelectorAll('#drum22ImportMode button').forEach(b=>b.onclick=()=>{d.querySelectorAll('#drum22ImportMode button').forEach(x=>x.classList.toggle('active',x===b));importPlan.mode=b.dataset.mode});
    d.querySelector('#drum22ChooseFiles').onclick=chooseAndImport
  }
  function setImportProgress(current,total,label='Importando'){const wrap=document.querySelector('#drum22ImportProgress'),bar=document.querySelector('#drum22ImportBar'),txt=document.querySelector('#drum22ImportText'),pct=document.querySelector('#drum22ImportPct');if(!wrap)return;wrap.hidden=false;const p=total?Math.round(current/total*100):0;bar.style.width=p+'%';pct.textContent=p+'%';txt.textContent=`${label} ${current}/${total}`}
  function prepareImportTarget(){
    if(importPlan.target!=='new')return true;const name=document.querySelector('#drum22BankName')?.value.trim();if(!name){toast('Digite o nome do novo banco');return false}
    let current=currentDrumBank();if(current)current.pads=cloneDrumPads(state.pads);const bank={id:`drum-bank-${Date.now()}`,name,pads:[],driveManaged:false};state.drumBanks.push(bank);state.activeDrumBankId=bank.id;state.pads=[];importPlan.bankName=name;return true
  }
  function isDuplicateFile(file){const name=String(file?.name||'').toLowerCase(),uri=String(file?.fileUri||'');return (state.pads||[]).some(p=>(uri&&p.nativeFileUri===uri)||String(p.fileName||'').toLowerCase()===name)}
  async function importNativePremium(files){
    if(!prepareImportTarget())return 0;let added=0,skipped=0,total=files.length;
    for(let n=0;n<files.length;n++){const file=files[n];setImportProgress(n,total,'Importando');if(!file?.fileUri||isDuplicateFile(file)){skipped++;continue}let i=state.pads.length;state.pads.push({name:(file.name||`PAD ${i+1}`).replace(/\.[^.]+$/,''),fileName:file.name||'Áudio',nativeFileUri:file.fileUri,color:padColors[i%padColors.length],volume:1,playMode:modeForImport(file)});added++;await new Promise(r=>setTimeout(r,0))}setImportProgress(total,total,'Concluído');save();renderDrums();setTimeout(()=>document.querySelector('#drum22ImportProgress').hidden=true,900);toast(`${added} som(ns) importado(s)${skipped?` · ${skipped} repetido(s) ignorado(s)`:''}`);return added
  }
  async function importWebPremium(files){
    if(!prepareImportTarget())return 0;let added=0,skipped=0,total=files.length;
    for(let n=0;n<files.length;n++){const file=files[n];setImportProgress(n,total,'Importando');if(isDuplicateFile(file)){skipped++;continue}try{let raw=await file.arrayBuffer(),i=state.pads.length,key=`pad-${Date.now()}-${i}-${n}`;await putPadAudio(key,raw);let duration=0;try{duration=(await ctx().decodeAudioData(raw.slice(0))).duration}catch{}state.pads.push({name:file.name.replace(/\.[^.]+$/,''),fileName:file.name,audioKey:key,color:padColors[i%padColors.length],volume:1,playMode:importPlan.mode==='auto'?inferMode(file.name,duration):safeMode(importPlan.mode)});raw=null;added++}catch(error){console.error(error)}await new Promise(r=>setTimeout(r,0))}setImportProgress(total,total,'Concluído');save();renderDrums();setTimeout(()=>document.querySelector('#drum22ImportProgress').hidden=true,900);toast(`${added} som(ns) importado(s)${skipped?` · ${skipped} repetido(s) ignorado(s)`:''}`);return added
  }
  async function chooseAndImport(){
    const btn=document.querySelector('#drum22ChooseFiles');if(btn.disabled)return;btn.disabled=true;try{
      if(nativePadPicker()){const result=await mediaLibrary().pickAudioFiles({multiple:true}),files=result?.files||[];if(files.length){await importNativePremium(files);document.querySelector('#drum22ImportDialog')?.close()}}
      else document.querySelector('#drumBankFiles')?.click()
    }catch(error){console.error(error);if(!String(error?.message||error).toLowerCase().includes('cancel'))toast('Não foi possível importar os sons')}finally{btn.disabled=false}
  }
  injectImportDialog();
  const importButton=document.querySelector('#importDrumSounds');if(importButton)importButton.onclick=()=>{importPlan={target:'current',bankName:'',mode:'auto'};const d=document.querySelector('#drum22ImportDialog');d.querySelectorAll('#drum22Target button').forEach(x=>x.classList.toggle('active',x.dataset.target==='current'));d.querySelector('#drum22BankName').hidden=true;d.querySelectorAll('#drum22ImportMode button').forEach(x=>x.classList.toggle('active',x.dataset.mode==='auto'));d.showModal()};
  const fallback=document.querySelector('#drumBankFiles');if(fallback)fallback.onchange=async e=>{const files=[...e.target.files];e.target.value='';if(files.length){await importWebPremium(files);document.querySelector('#drum22ImportDialog')?.close()}};

  const addButton=document.querySelector('#addDrumPad'),coreAdd=addButton?.onclick;if(addButton&&coreAdd)addButton.onclick=e=>{const before=state.pads.length;coreAdd.call(addButton,e);if(state.pads[before]&&!state.pads[before].playMode)state.pads[before].playMode='oneshot';save();renderDrums()};

  injectStyles();injectConsole();renderDrums();
  window.PulsarDrum22={version:VERSION,stopAll:stopEverything,refresh:renderDrums};
})();
