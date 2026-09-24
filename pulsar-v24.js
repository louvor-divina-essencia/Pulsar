/* PULSAR 2.4 — biblioteca Drum sem automapeamento + Studio com roteamento */
(() => {
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const esc = v => typeof clean === 'function' ? clean(v) : String(v ?? '').replace(/[&<>"']/g, '');
  const drivePlugin = () => window.Capacitor?.Plugins?.NexoDrive;

  function blankPad(i){ return {name:`PAD ${i+1}`,color:padColors[i%padColors.length],volume:1}; }

  function migrateAutoDrumBanksToLibrary(){
    try{
      state.driveOfflineAssets ??= {};
      state.drumBanks ??= [];
      const autoBanks = state.drumBanks.filter(b => b?.driveManaged);
      for(const bank of autoBanks){
        for(const p of bank.pads || []){
          if(p?.driveSourceId && p?.nativeFileUri){
            state.driveOfflineAssets[p.driveSourceId] = {
              fileUri:p.nativeFileUri,
              name:p.fileName || p.name || 'Áudio',
              bankName:p.driveBankName || bank.name || 'Drive',
              cachedAt:state.driveOfflineAssets[p.driveSourceId]?.cachedAt || Date.now()
            };
          }
        }
      }
      let manual = state.drumBanks.filter(b => !b?.driveManaged);
      let active = manual.find(b => b.id === state.activeDrumBankId) || manual[0];
      if(!active){ active={id:`drum-main-${Date.now()}`,name:'MEUS PADS',pads:[],driveManaged:false}; manual=[active]; }
      active.pads = Array.isArray(active.pads) ? active.pads : [];
      while(active.pads.length < 6) active.pads.push(blankPad(active.pads.length));
      state.drumBanks = manual;
      state.activeDrumBankId = active.id;
      state.pads = JSON.parse(JSON.stringify(active.pads));
      save();
      renderDrums?.();
      const count=q('#drumBankCount'); if(count) count.textContent=`${state.pads.length} PADS · 6 BASE`;
    }catch(error){ console.warn('PULSAR 2.4: migração Drum',error); }
  }

  function offlineCountForBank(bank){
    const files=bank?.files||[];
    return files.filter(f=>state.driveOfflineAssets?.[f.sourceId]?.fileUri).length;
  }

  function decorateDrumLibrary(result){
    const drums=result?.drumBanks||[];
    qa('.drive-bank[data-drive-kind="Drums"]').forEach(card=>{
      const bank=drums.find(b=>String(b.name)===String(card.dataset.driveBank));
      if(!bank)return;
      const total=(bank.files||[]).length || +bank.count || 0;
      const offline=offlineCountForBank(bank);
      const small=card.querySelector('small');
      if(small){
        const base=small.textContent.replace(/ · SINCRONIZADO.*$/,'').replace(/ · OFFLINE.*$/,'').replace(/ · NUVEM.*$/,'');
        small.textContent=`${base} · ${offline}/${total} OFFLINE · DISPONÍVEL PARA MAPEAR`;
      }
      const btn=card.querySelector('button');
      if(btn) btn.textContent=offline>=total&&total>0?'ATUALIZAR OFFLINE':'DEIXAR OFFLINE';
      card.classList.toggle('offline',offline>0);
    });
  }

  function patchDriveLibraryDisplay(){
    if(typeof renderDriveLibrary!=='function'||renderDriveLibrary.__p24)return;
    const previous=renderDriveLibrary;
    renderDriveLibrary=function(result){
      previous(result);
      migrateAutoDrumBanksToLibrary();
      decorateDrumLibrary(result);
    };
    renderDriveLibrary.__p24=true;
  }

  function patchDrumOfflineDownload(){
    if(typeof downloadDriveBank!=='function'||downloadDriveBank.__p24)return;
    const original=downloadDriveBank;
    downloadDriveBank=async function(kind,bankName){
      if(kind!=='Drums') return original(kind,bankName);
      if(typeof driveBusy!=='undefined'&&driveBusy)return;
      try{
        setDriveBusy?.(true,`Baixando ${bankName==='__ROOT__'?'Drums':bankName} para a biblioteca…`);
        await attachDriveProgress?.();
        const result=await drivePlugin().downloadBank({kind:'Drums',bankName});
        state.driveOfflineAssets ??= {};
        for(const f of result.files||[]){
          if(!f?.sourceId||!f?.fileUri)continue;
          state.driveOfflineAssets[f.sourceId]={fileUri:f.fileUri,name:f.name||'Áudio',bankName:result.bankName||bankName,cachedAt:Date.now(),driveRelativePath:f.driveRelativePath||f.relativePath||''};
        }
        save();
        migrateAutoDrumBanksToLibrary();
        if(typeof driveLastLibrary!=='undefined'&&driveLastLibrary)decorateDrumLibrary(driveLastLibrary);
        const ok=(result.files||[]).length,failed=+result.failed||0;
        toast(failed?`${ok} timbres offline · ${failed} falharam`:`${ok} timbres offline · prontos para mapear`);
      }catch(error){
        console.error(error);toast('Não foi possível deixar este banco offline');
      }finally{ setDriveBusy?.(false); }
    };
    downloadDriveBank.__p24=true;
  }

  // ------------------------------------------------------------
  // STUDIO MIX: monitor e gravação são coisas separadas.
  // PAD/DRUM podem continuar tocando sem necessariamente entrar no take.
  // ------------------------------------------------------------
  state.studioCapture ??= {mic:true,pad:true,drum:false};
  const studioMix={ctx:null,destination:null,gains:{},tapped:{pad:new WeakSet(),drum:new WeakSet()},recorder:null,chunks:[],micStream:null,micSource:null,startedAt:0,timer:null,currentAudio:null,padMirrors:new Map()};

  function ensureMix(){
    if(studioMix.destination)return studioMix;
    const c=ctx();studioMix.ctx=c;studioMix.destination=c.createMediaStreamDestination();
    for(const kind of ['pad','drum','mic']){const g=c.createGain();g.gain.value=state.studioCapture[kind]===false?0:1;g.connect(studioMix.destination);studioMix.gains[kind]=g;}
    return studioMix;
  }
  function updateMixGains(){
    const m=ensureMix();
    for(const kind of ['pad','drum','mic'])m.gains[kind].gain.setTargetAtTime(state.studioCapture[kind]===false?0:1,m.ctx.currentTime,.02);
  }
  function tapNode(kind,node){
    if(!node||!['pad','drum'].includes(kind))return;
    const m=ensureMix();if(m.tapped[kind].has(node))return;
    try{node.connect(m.gains[kind]);m.tapped[kind].add(node)}catch(error){console.warn('PULSAR Studio tap',kind,error)}
  }
  window.PulsarStudioMix={tap:tapNode,get active(){return studioMix.recorder?.state==='recording'},get capturePadEnabled(){return !!state.studioCapture.pad}};

  function patchAudioSources(){
    try{
      if(typeof connectDrum==='function'&&!connectDrum.__p24){const old=connectDrum;connectDrum=function(node){old(node);tapNode('drum',node)};connectDrum.__p24=true;}
      if(typeof prepareAmbientWebVoice==='function'&&!prepareAmbientWebVoice.__p24){const old=prepareAmbientWebVoice;prepareAmbientWebVoice=async function(asset){const voice=await old(asset);if(voice?.gain)tapNode('pad',voice.gain);return voice};prepareAmbientWebVoice.__p24=true;}
      if(typeof playAmbientNote==='function'&&!playAmbientNote.__p24){const old=playAmbientNote;playAmbientNote=async function(noteKey){const r=await old(noteKey);if(studioMix.recorder?.state==='recording'&&state.studioCapture.pad)syncNativePadMirrors();return r};playAmbientNote.__p24=true;}
      if(typeof stopAmbientNow==='function'&&!stopAmbientNow.__p24){const old=stopAmbientNow;stopAmbientNow=async function(){stopAllPadMirrors();return old()};stopAmbientNow.__p24=true;}
    }catch(error){console.warn('PULSAR 2.4: patch de áudio',error)}
  }

  async function startNativePadMirror(voice){
    if(!voice?.native||studioMix.padMirrors.has(voice.assetId))return;
    try{
      const asset=ambientAsset(voice.assetId);if(!asset)return;
      const raw=await rawForPad(asset);if(!raw)return;
      const c=ctx(),buffer=await c.decodeAudioData(raw.slice(0)),source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
      source.buffer=buffer;source.loop=true;filter.type='lowpass';filter.frequency.value=typeof cutoffHz==='function'?cutoffHz():20000;gain.gain.value=Math.max(.0001,+state.ambientSettings?.volume||.7);
      source.connect(filter).connect(gain).connect(ensureMix().gains.pad);source.start();
      studioMix.padMirrors.set(voice.assetId,{source,filter,gain,noteKey:voice.noteKey});
    }catch(error){console.warn('PULSAR Studio: espelho de Pad',error)}
  }
  function stopPadMirror(assetId){const x=studioMix.padMirrors.get(assetId);if(!x)return;try{x.source.stop()}catch{}try{x.source.disconnect();x.filter.disconnect();x.gain.disconnect()}catch{}studioMix.padMirrors.delete(assetId)}
  function stopAllPadMirrors(){for(const id of [...studioMix.padMirrors.keys()])stopPadMirror(id)}
  async function syncNativePadMirrors(){
    if(!state.studioCapture.pad||studioMix.recorder?.state!=='recording'){stopAllPadMirrors();return;}
    try{
      const active=new Set((ambientVoices||[]).filter(v=>v?.native).map(v=>v.assetId));
      for(const id of [...studioMix.padMirrors.keys()])if(!active.has(id))stopPadMirror(id);
      for(const voice of (ambientVoices||[]).filter(v=>v?.native))await startNativePadMirror(voice);
    }catch(error){console.warn('PULSAR Studio: sincronização dos Pads',error)}
  }

  function studioDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('pulsar-studio',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('takes'))req.result.createObjectStore('takes',{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function storeTake(take){const db=await studioDb();return new Promise((resolve,reject)=>{const tx=db.transaction('takes','readwrite');tx.objectStore('takes').put(take);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
  async function listTakes(){const db=await studioDb();return new Promise((resolve,reject)=>{const tx=db.transaction('takes');const req=tx.objectStore('takes').getAll();req.onsuccess=()=>{db.close();resolve((req.result||[]).sort((a,b)=>b.createdAt-a.createdAt))};req.onerror=()=>reject(req.error)})}
  async function deleteTake(id){const db=await studioDb();return new Promise((resolve,reject)=>{const tx=db.transaction('takes','readwrite');tx.objectStore('takes').delete(id);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
  const clock=ms=>{let s=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};

  function injectRoutingUi(){
    const rec=q('.studio-rec-card');if(!rec||q('#studioRouting'))return;
    const box=document.createElement('div');box.id='studioRouting';box.className='studio-routing-v24';box.innerHTML=`<div class="studio-routing-head"><div><small>ROTEAMENTO DA GRAVAÇÃO</small><b>O que entra no take?</b></div><span>O que você ouve continua tocando normalmente.</span></div><div class="studio-routing-grid">
      <label><input id="studioTakeMic" type="checkbox"><span><i>MIC</i><b>Voz / instrumento</b><small>Entrada do microfone</small></span></label>
      <label><input id="studioTakePad" type="checkbox"><span><i>PAD</i><b>Cama de Pad</b><small>Inclui Pads de tonalidade</small></span></label>
      <label><input id="studioTakeDrum" type="checkbox"><span><i>DRUM</i><b>Bateria / samples</b><small>Inclui o Drum Pad</small></span></label>
    </div><p class="studio-routing-note">Ex.: deixe <b>PAD ligado</b> para gravar a cama junto com sua voz. Desligue PAD para você ouvir a cama, mas ela não sair no arquivo gravado.</p>`;
    rec.insertBefore(box,rec.querySelector('.studio-record-button'));
    const map={studioTakeMic:'mic',studioTakePad:'pad',studioTakeDrum:'drum'};
    for(const [id,kind] of Object.entries(map)){const el=q('#'+id);el.checked=state.studioCapture[kind]!==false;el.onchange=()=>{state.studioCapture[kind]=el.checked;save();updateMixGains();if(kind==='pad'){if(el.checked)syncNativePadMirrors();else stopAllPadMirrors()}};}
    const p=rec.querySelector(':scope > p');if(p)p.textContent='Use fones para evitar que o som do aparelho volte pelo microfone. Os seletores acima definem o que é gravado, não o que você escuta.';
  }

  function setRecordingUi(on,stateText=on?'GRAVANDO':'PRONTO'){
    const button=q('#studioRecord');if(!button)return;
    q('#studioRecState').textContent=stateText;q('#studioRecLight').classList.toggle('on',on);button.classList.toggle('recording',on);button.querySelector('b').textContent=on?'PARAR':'GRAVAR';
    if(!on&&stateText==='PRONTO')q('#studioRecTime').textContent='00:00';
  }

  async function startMixedRecording(){
    try{
      const m=ensureMix();updateMixGains();studioMix.chunks=[];
      if(state.studioCapture.mic!==false){
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microfone indisponível');
        studioMix.micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
        studioMix.micSource=m.ctx.createMediaStreamSource(studioMix.micStream);studioMix.micSource.connect(m.gains.mic);
      }
      let mime='';for(const candidate of ['audio/webm;codecs=opus','audio/webm','audio/mp4'])if(MediaRecorder.isTypeSupported?.(candidate)){mime=candidate;break}
      studioMix.recorder=new MediaRecorder(m.destination.stream,mime?{mimeType:mime}:undefined);
      studioMix.recorder.ondataavailable=e=>{if(e.data?.size)studioMix.chunks.push(e.data)};
      studioMix.recorder.onstop=finalizeMixedRecording;
      studioMix.startedAt=Date.now();studioMix.recorder.start(250);setRecordingUi(true);
      clearInterval(studioMix.timer);studioMix.timer=setInterval(()=>{const el=q('#studioRecTime');if(el)el.textContent=clock(Date.now()-studioMix.startedAt)},250);
      if(state.studioCapture.pad)await syncNativePadMirrors();
      toast('Gravação iniciada com o roteamento selecionado');
    }catch(error){console.error(error);cleanupMic();setRecordingUi(false);toast(state.studioCapture.mic!==false?'Autorize o microfone para gravar':'Não foi possível iniciar a gravação')}
  }
  function cleanupMic(){try{studioMix.micSource?.disconnect()}catch{}studioMix.micSource=null;studioMix.micStream?.getTracks?.().forEach(t=>t.stop());studioMix.micStream=null}
  function stopMixedRecording(){try{studioMix.recorder?.stop()}catch{}clearInterval(studioMix.timer);cleanupMic();stopAllPadMirrors();setRecordingUi(false,'SALVANDO')}
  async function finalizeMixedRecording(){
    try{
      const blob=new Blob(studioMix.chunks,{type:studioMix.recorder?.mimeType||'audio/webm'});if(!blob.size)throw new Error('empty');
      const createdAt=Date.now(),duration=Date.now()-studioMix.startedAt,capture={...state.studioCapture};
      await storeTake({id:`take-${createdAt}`,name:`Take ${new Date(createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`,blob,type:blob.type,createdAt,duration,capture});
      setRecordingUi(false,'PRONTO');await renderTakes();toast('Take salvo com o mix selecionado');
    }catch(error){console.error(error);setRecordingUi(false,'ERRO');toast('Não foi possível salvar a gravação')}finally{studioMix.chunks=[];studioMix.recorder=null}
  }

  async function renderTakes(){
    const list=q('#studioTakes');if(!list)return;
    try{
      const takes=await listTakes();q('#studioTakeCount').textContent=takes.length;
      list.innerHTML=takes.length?takes.map(t=>{const c=t.capture||{};const tags=[c.mic!==false?'MIC':'',c.pad?'PAD':'',c.drum?'DRUM':''].filter(Boolean).join(' + ');return `<article class="studio-take" data-id="${esc(t.id)}"><button class="studio-take-play" type="button">▶</button><div><b>${esc(t.name)}</b><small>${clock(t.duration)} · ${new Date(t.createdAt).toLocaleDateString('pt-BR')}${tags?' · '+tags:''}</small></div><button class="studio-take-delete" type="button">×</button></article>`}).join(''):'<div class="studio-empty">Nenhum take gravado ainda.</div>';
      list.querySelectorAll('.studio-take').forEach((row,index)=>{const take=takes[index];row.querySelector('.studio-take-play').onclick=()=>playTake(take,row);row.querySelector('.studio-take-delete').onclick=async()=>{await deleteTake(take.id);renderTakes()}});
    }catch(error){console.error(error)}
  }
  function playTake(take,row){try{if(studioMix.currentAudio){studioMix.currentAudio.pause();studioMix.currentAudio=null;qa('.studio-take.playing').forEach(x=>x.classList.remove('playing'))}const url=URL.createObjectURL(take.blob),audio=new Audio(url);studioMix.currentAudio=audio;row.classList.add('playing');audio.onended=()=>{row.classList.remove('playing');URL.revokeObjectURL(url);if(studioMix.currentAudio===audio)studioMix.currentAudio=null};audio.play()}catch(error){console.error(error);toast('Não foi possível tocar este take')}}

  function replaceStudioRecorder(){
    const btn=q('#studioRecord');if(!btn)return;btn.onclick=()=>studioMix.recorder?.state==='recording'?stopMixedRecording():startMixedRecording();renderTakes();
  }

  function init(){
    migrateAutoDrumBanksToLibrary();patchDriveLibraryDisplay();patchDrumOfflineDownload();patchAudioSources();injectRoutingUi();replaceStudioRecorder();
    setTimeout(migrateAutoDrumBanksToLibrary,1800);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
