/* PULSAR 2.7 — transposição única + biblioteca local de samples */
(() => {
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const samplePlugin = () => window.Capacitor?.Plugins?.SampleLibrary;
  const mediaPlugin = () => window.Capacitor?.Plugins?.MediaLibrary;
  const esc = v => typeof clean === 'function' ? clean(v) : String(v ?? '').replace(/[&<>"']/g, '');

  let localMode = false;
  let localFiles = [];
  let localScope = '__ALL__';
  let localQuery = '';
  let localSelected = new Set();
  let localLoading = false;
  let localPending = false;
  let previewTimer = null;
  let pickerPatched = false;
  let pickerSearchOriginal = null;
  let pickerRefreshOriginal = null;
  let savePadOriginal = null;
  let previewPadOriginal = null;

  state.localDrumCollections ??= [];

  function basenameFolder(value){
    const parts=String(value||'Armazenamento').replace(/\\/g,'/').split('/').filter(Boolean);
    return parts.at(-1)||'Armazenamento';
  }
  function formatDuration(ms){
    const sec=Math.max(0,Math.round((+ms||0)/1000));
    return sec<60?`${sec}s`:`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
  }
  function normalize(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function saveState(){try{save()}catch{try{localStorage.setItem('up-state',JSON.stringify(state))}catch{}}}

  // ------------------------------------------------------------
  // PLAYER — uma única transposição, usando o layout aprovado.
  // ------------------------------------------------------------
  const pitchNames=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
  const pitchMap={C:0,'B#':0,'C#':1,DB:1,D:2,'D#':3,EB:3,E:4,FB:4,'E#':5,F:5,'F#':6,GB:6,G:7,'G#':8,AB:8,A:9,'A#':10,BB:10,B:11,CB:11};
  function transposeKey(key,amount){
    const raw=String(key||'').trim();if(!raw||raw==='—')return '—';
    const minor=/m$/i.test(raw),root=raw.replace(/m$/i,'').replace('♯','#').replace('♭','b');
    const pc=pitchMap[root.toUpperCase()];if(pc===undefined)return raw;
    return pitchNames[(pc+Math.round(+amount||0)+120)%12]+(minor?'m':'');
  }
  function detectedKey(){return q('#nowKey')?.textContent?.replace(/^TOM\s*/i,'').trim()||'—';}
  function updateToneCard(){
    const input=q('#nowPitch');if(!input)return;
    const pitch=Math.round(+input.value||0),base=detectedKey(),current=transposeKey(base,pitch);
    const currentEl=q('#p27ToneCurrent'),baseEl=q('#p27ToneBase'),shiftEl=q('#p27ToneShift');
    if(currentEl)currentEl.textContent=current==='—'?(pitch===0?'0 st':`${pitch>0?'+':''}${pitch} st`):current;
    if(baseEl)baseEl.textContent=base==='—'?'TOM ORIGINAL NÃO IDENTIFICADO':`ORIGINAL ${base}`;
    if(shiftEl)shiftEl.textContent=pitch===0?'ORIGINAL':`${pitch>0?'+':''}${pitch} SEMITOM${Math.abs(pitch)===1?'':'S'}`;
  }
  function setPitch(value){
    const input=q('#nowPitch');if(!input)return;
    input.min='-12';input.max='12';input.step='1';input.value=String(Math.max(-12,Math.min(12,Math.round(+value||0))));
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));updateToneCard();
  }
  function buildSingleToneCard(){
    const content=q('#nowPlaying .now-content');const input=q('#nowPitch');if(!content||!input)return;
    let host=q('#p27PitchHost');if(!host){host=document.createElement('div');host.id='p27PitchHost';host.hidden=true;content.appendChild(host)}
    host.appendChild(input);
    if(!q('#nowPitchValue')){const span=document.createElement('span');span.id='nowPitchValue';span.hidden=true;host.appendChild(span)}
    q('#p25PitchCard')?.remove();q('#pitchSelectorV21')?.remove();qa('.p26-tone-card').forEach(x=>x.remove());q('#p27ToneCard')?.remove();
    const card=document.createElement('section');card.id='p27ToneCard';card.className='p27-tone-card';card.innerHTML=`
      <div class="p27-tone-head"><span class="p27-tone-icon">♪</span><div><b>Transposição / Tom</b><small>Altere o tom sem mudar a velocidade.</small></div><button id="p27ToneReset" type="button">↻ Resetar</button></div>
      <div class="p27-tone-controls"><button id="p27ToneMinus" type="button" aria-label="Baixar um semitom">−</button><div><b id="p27ToneCurrent">—</b><small id="p27ToneShift">ORIGINAL</small></div><button id="p27TonePlus" type="button" aria-label="Subir um semitom">＋</button></div>
      <div class="p27-tone-base" id="p27ToneBase">TOM ORIGINAL NÃO IDENTIFICADO</div>`;
    const volume=q('.p26-volume-card')||q('#nowVolume')?.closest('label')||q('#nowPlaying .now-mix');
    if(volume?.parentNode)volume.parentNode.insertBefore(card,volume);else content.appendChild(card);
    q('#p27ToneMinus').onclick=()=>setPitch((+input.value||0)-1);q('#p27TonePlus').onclick=()=>setPitch((+input.value||0)+1);q('#p27ToneReset').onclick=()=>setPitch(0);
    input.addEventListener('input',updateToneCard);updateToneCard();
    const study=q('#nowPlaying .study-tools-v14');const volumeCard=q('.p26-volume-card');if(study&&volumeCard?.parentNode)volumeCard.after(study);
  }

  // ------------------------------------------------------------
  // DRUM — Drive e dispositivo no mesmo navegador, com preview.
  // ------------------------------------------------------------
  function importedRows(collection){return (collection?.files||[]).map((file,index)=>({kind:'imported',file,index,collection,name:file.name||`Sample ${index+1}`,uri:file.fileUri,folder:collection.name,duration:file.duration||0}));}
  function deviceFolders(){
    const map=new Map();for(const f of localFiles){const folder=f.folder||'Armazenamento';map.set(folder,(map.get(folder)||0)+1)}
    return [...map.entries()].sort((a,b)=>{const ad=/download/i.test(a[0])?-1:0,bd=/download/i.test(b[0])?-1:0;return ad-bd||a[0].localeCompare(b[0],'pt-BR')});
  }
  function currentLocalRows(){
    let rows=[];
    if(localScope.startsWith('collection:')){
      const id=localScope.slice(11),collection=state.localDrumCollections.find(c=>c.id===id);rows=importedRows(collection);
    }else{
      rows=localFiles.map((file,index)=>({kind:'device',file,index,name:file.name||'Áudio',uri:file.uri,folder:file.folder||'Armazenamento',duration:file.duration||0}));
      if(localScope!=='__ALL__')rows=rows.filter(r=>r.folder===localScope);
    }
    if(localQuery){const needle=normalize(localQuery);rows=rows.filter(r=>normalize(`${r.name} ${r.folder}`).includes(needle))}
    return rows;
  }
  function ensureLocalUi(){
    const shell=q('#pulsarDriveSoundPicker .drive-picker-shell');if(!shell||q('#p27LocalActions'))return;
    const actions=document.createElement('div');actions.id='p27LocalActions';actions.className='p27-local-actions';actions.hidden=true;actions.innerHTML=`
      <div><small>SELEÇÃO LOCAL</small><b id="p27SelectedCount">0 selecionados</b></div>
      <button id="p27ImportSelected" type="button" disabled>IMPORTAR SELECIONADOS</button>
      <button id="p27ImportFiles" type="button">＋ ESCOLHER ARQUIVOS</button>`;
    q('#drivePickerBanks')?.before(actions);
    const naming=document.createElement('div');naming.id='p27ImportNaming';naming.className='p27-import-naming';naming.hidden=true;naming.innerHTML=`<div><small>NOVA COLEÇÃO</small><b>Dê um nome para estes samples</b></div><input id="p27ImportName" maxlength="36" placeholder="Ex.: Bateria acústica, FX, Starter"><button id="p27ImportCancel" type="button">CANCELAR</button><button id="p27ImportConfirm" type="button">IMPORTAR</button>`;actions.after(naming);
    q('#p27ImportSelected').onclick=()=>showNamingForSelection();q('#p27ImportFiles').onclick=()=>importFromSystemPicker();q('#p27ImportCancel').onclick=()=>{naming.hidden=true};
  }
  function patchPicker(){
    const dlg=q('#pulsarDriveSoundPicker');if(!dlg||pickerPatched)return;pickerPatched=true;ensureLocalUi();
    const source=q('#pulsarDriveSoundPicker .drive-picker-source');const oldLocal=q('#drivePickerLocal'),driveBtn=source?.querySelector('button:first-child');const search=q('#drivePickerSearch'),refresh=q('#drivePickerRefresh');
    if(!oldLocal||!driveBtn||!search||!refresh)return;
    const localBtn=oldLocal.cloneNode(true);oldLocal.replaceWith(localBtn);localBtn.id='drivePickerLocal';
    pickerSearchOriginal=search.oninput;pickerRefreshOriginal=refresh.onclick;
    search.oninput=e=>{if(localMode){localQuery=e.target.value||'';renderLocalBrowser()}else pickerSearchOriginal?.call(search,e)};
    refresh.onclick=e=>{if(localMode)loadLocalLibrary(true);else pickerRefreshOriginal?.call(refresh,e)};
    localBtn.onclick=()=>enterLocalMode();driveBtn.onclick=()=>leaveLocalMode();
    const close=q('#drivePickerClose');close?.addEventListener('click',()=>stopLocalPreview());dlg.addEventListener('close',()=>{stopLocalPreview();localPending=false;});
    savePadOriginal=q('#savePad')?.onclick||savePadOriginal;previewPadOriginal=q('#previewPad')?.onclick||previewPadOriginal;
    if(q('#savePad'))q('#savePad').onclick=e=>localPending?saveLocalPad(e):savePadOriginal?.call(q('#savePad'),e);
    if(q('#previewPad'))q('#previewPad').onclick=e=>localPending?previewPendingLocal():previewPadOriginal?.call(q('#previewPad'),e);
  }
  function enterLocalMode(){
    localMode=true;localPending=false;ensureLocalUi();const dlg=q('#pulsarDriveSoundPicker');const source=dlg?.querySelector('.drive-picker-source');source?.querySelectorAll('button').forEach((b,i)=>b.classList.toggle('active',i===1));
    q('.drive-offline-choice')&&(q('.drive-offline-choice').hidden=true);q('#p27LocalActions').hidden=false;q('#p27ImportNaming').hidden=true;q('#drivePickerRefresh').textContent='↻ ATUALIZAR CELULAR';q('#drivePickerSearch').placeholder='Buscar sample, pasta ou arquivo...';q('#drivePickerSearch').value='';localQuery='';localScope='__ALL__';loadLocalLibrary(false);
  }
  function leaveLocalMode(){
    localMode=false;localPending=false;stopLocalPreview();const source=q('#pulsarDriveSoundPicker .drive-picker-source');source?.querySelectorAll('button').forEach((b,i)=>b.classList.toggle('active',i===0));
    q('.drive-offline-choice')&&(q('.drive-offline-choice').hidden=false);q('#p27LocalActions')&&(q('#p27LocalActions').hidden=true);q('#p27ImportNaming')&&(q('#p27ImportNaming').hidden=true);q('#drivePickerRefresh').textContent='↻ ATUALIZAR DRIVE';q('#drivePickerSearch').placeholder='Buscar bumbo, caixa, loop...';q('#drivePickerSearch').value='';localQuery='';
    pickerSearchOriginal?.call(q('#drivePickerSearch'),{target:q('#drivePickerSearch')});
  }
  async function loadLocalLibrary(force=false){
    if(localLoading)return;const plugin=samplePlugin();if(!plugin?.getAudioFiles){q('#drivePickerList').innerHTML='<div class="drive-picker-empty">Atualize o APK para usar a biblioteca local de samples.</div>';return}
    if(localFiles.length&&!force)return renderLocalBrowser();localLoading=true;q('#drivePickerList').innerHTML='<div class="drive-picker-loading"><i></i><b>Lendo os áudios do celular…</b></div>';
    try{const result=await plugin.getAudioFiles();localFiles=result?.files||[];renderLocalBrowser()}catch(error){console.error(error);q('#drivePickerList').innerHTML='<div class="drive-picker-empty">Não foi possível ler os áudios. Autorize o acesso a músicas/áudio do aparelho.</div>'}finally{localLoading=false}
  }
  function renderLocalBrowser(){
    if(!localMode)return;ensureLocalUi();const tabs=q('#drivePickerBanks'),list=q('#drivePickerList');if(!tabs||!list)return;
    const folders=deviceFolders(),collections=state.localDrumCollections||[];
    tabs.innerHTML=`<button class="${localScope==='__ALL__'?'active':''}" data-local-scope="__ALL__">TODOS <small>${localFiles.length}</small></button>`+
      folders.map(([folder,count])=>`<button class="${localScope===folder?'active':''}" data-local-scope="${esc(folder)}">${esc(basenameFolder(folder))}<small>${count}</small></button>`).join('')+
      collections.map(c=>`<button class="p27-collection-tab ${localScope===`collection:${c.id}`?'active':''}" data-local-collection="${esc(c.id)}">★ ${esc(c.name)}<small>${c.files?.length||0}</small></button>`).join('');
    tabs.querySelectorAll('[data-local-scope]').forEach(b=>b.onclick=()=>{localScope=b.dataset.localScope;renderLocalBrowser()});tabs.querySelectorAll('[data-local-collection]').forEach(b=>b.onclick=()=>{localScope=`collection:${b.dataset.localCollection}`;renderLocalBrowser()});
    const rows=currentLocalRows();
    list.innerHTML=rows.length?rows.map((r,index)=>`<article class="drive-sound-row p27-local-row" data-local-row="${index}">
      ${r.kind==='device'?`<label class="p27-select-sample"><input type="checkbox" data-select-uri="${esc(r.uri)}" ${localSelected.has(r.uri)?'checked':''}><span>✓</span></label>`:'<span class="p27-imported-badge">SALVO</span>'}
      <button class="drive-sound-preview" type="button" title="Testar">▶</button>
      <div class="p27-local-copy"><b>${esc(String(r.name).replace(/\.[^.]+$/,''))}</b><small>${esc(basenameFolder(r.folder))} · ${formatDuration(r.duration)}</small></div>
      <button class="drive-sound-use" type="button">USAR</button></article>`).join(''):'<div class="drive-picker-empty">Nenhum áudio encontrado com este filtro.</div>';
    list.querySelectorAll('[data-local-row]').forEach((el,index)=>{const row=rows[index];el.querySelector('.drive-sound-preview').onclick=()=>previewLocal(row,el);el.querySelector('.drive-sound-use').onclick=()=>useLocal(row);el.querySelector('[data-select-uri]')?.addEventListener('change',e=>{e.target.checked?localSelected.add(row.uri):localSelected.delete(row.uri);updateSelectionUi()})});
    q('#drivePickerInfo').textContent=`${rows.length} áudio${rows.length===1?'':'s'} · toque em ▶ para testar`;updateSelectionUi();
  }
  function updateSelectionUi(){const n=localSelected.size,count=q('#p27SelectedCount'),btn=q('#p27ImportSelected');if(count)count.textContent=`${n} selecionado${n===1?'':'s'}`;if(btn){btn.disabled=n===0;btn.textContent=n?`IMPORTAR ${n} SELECIONADO${n===1?'':'S'}`:'IMPORTAR SELECIONADOS'}}
  async function previewLocal(row,el){
    try{clearTimeout(previewTimer);await samplePlugin()?.stopPreview?.().catch(()=>{});qa('#drivePickerList .drive-sound-preview.playing').forEach(b=>b.classList.remove('playing'));const btn=el.querySelector('.drive-sound-preview');btn.classList.add('playing');await samplePlugin().preview({uri:row.uri});previewTimer=setTimeout(()=>btn.classList.remove('playing'),4500)}catch(error){console.error(error);toast('Não foi possível testar este áudio')}
  }
  async function stopLocalPreview(){clearTimeout(previewTimer);try{await samplePlugin()?.stopPreview?.()}catch{}qa('#drivePickerList .drive-sound-preview.playing').forEach(b=>b.classList.remove('playing'))}
  async function duplicateForPad(uri){const result=await samplePlugin().importAudioUris({uris:[uri]});return result?.files?.[0]||null}
  async function useLocal(row){
    try{q('#drivePickerInfo').textContent='Preparando sample…';const copy=await duplicateForPad(row.uri);if(!copy)throw new Error('copy failed');await stopLocalPreview();localPending=true;await receiveNativePadFile(copy);const hint=q('#padDriveSourceHint');if(hint)hint.textContent=`Biblioteca local · ${basenameFolder(row.folder)}`;q('#pulsarDriveSoundPicker')?.close();toast('Sample pronto para testar ou salvar')}
    catch(error){console.error(error);toast('Não foi possível preparar este sample')}
  }
  async function previewPendingLocal(){try{if(!pendingNativeFile?.fileUri)return toast('Escolha um sample primeiro');await samplePlugin()?.stopPreview?.().catch(()=>{});await samplePlugin().preview({uri:pendingNativeFile.fileUri});q('.mini-meter')?.classList.add('playing');setTimeout(()=>q('.mini-meter')?.classList.remove('playing'),2500)}catch(error){console.error(error);toast('Não foi possível testar este sample')}}
  async function saveLocalPad(){
    const p=state.pads[editorIndex];if(!p||!pendingNativeFile)return;
    try{
      p.name=q('#padName').value.trim()||p.name;p.color=q('#padColor').value;p.volume=+q('#padVolume').value;delete p.repeat;
      if(p.audioKey)await removePadAudio(p.audioKey);if(p.nativeFileUri&&p.nativeFileUri!==pendingNativeFile.fileUri)await discardNativePadFile(p.nativeFileUri);
      delete p.driveSourceId;delete p.driveRelativePath;delete p.driveBankName;delete p.driveManaged;delete p.driveCloud;delete p.audioKey;delete p.buffer;
      p.nativeFileUri=pendingNativeFile.fileUri;p.fileName=pendingNativeFile.name||'Áudio';
      try{padRawCache.delete(nativePadCacheKey(p.nativeFileUri));padDecodedCache.delete(nativePadCacheKey(p.nativeFileUri))}catch{}
      pendingBuffer=null;pendingNativeFile=null;stopDrumLoop(editorIndex);save();resetPendingPadFile();renderDrums();q('#padEditor').close();localPending=false;toast('Pad salvo com sample local')
    }catch(error){console.error(error);toast('Não foi possível salvar este sample')}
  }

  function showNamingForSelection(){
    if(!localSelected.size)return;const panel=q('#p27ImportNaming'),input=q('#p27ImportName');if(!panel||!input)return;panel.hidden=false;const folder=localScope!=='__ALL__'&&!localScope.startsWith('collection:')?basenameFolder(localScope):'Meus Samples';input.value=folder;input.focus();q('#p27ImportConfirm').onclick=()=>confirmSelectedImport(input.value.trim()||'Meus Samples');
  }
  async function confirmSelectedImport(name){
    const panel=q('#p27ImportNaming'),button=q('#p27ImportConfirm');const uris=[...localSelected];if(!uris.length)return;button.disabled=true;button.textContent='IMPORTANDO…';
    try{const result=await samplePlugin().importAudioUris({uris});const files=result?.files||[];if(!files.length)throw new Error('no files');const collection={id:`local-${Date.now()}`,name,createdAt:Date.now(),files};state.localDrumCollections.push(collection);saveState();localSelected.clear();localScope=`collection:${collection.id}`;panel.hidden=true;renderLocalBrowser();toast(`${files.length} sample${files.length===1?'':'s'} importado${files.length===1?'':'s'} para ${name}`)}catch(error){console.error(error);toast('Não foi possível importar os samples selecionados')}finally{button.disabled=false;button.textContent='IMPORTAR'}
  }
  async function importFromSystemPicker(){
    try{const result=await mediaPlugin()?.pickAudioFiles?.({multiple:true});const files=result?.files||[];if(!files.length)return;const panel=q('#p27ImportNaming'),input=q('#p27ImportName');panel.hidden=false;input.value='Meus Samples';input.focus();q('#p27ImportConfirm').onclick=()=>{const name=input.value.trim()||'Meus Samples';const collection={id:`local-${Date.now()}`,name,createdAt:Date.now(),files};state.localDrumCollections.push(collection);saveState();localScope=`collection:${collection.id}`;panel.hidden=true;renderLocalBrowser();toast(`${files.length} arquivos adicionados a ${name}`)}}catch(error){if(!String(error?.message||error).toLowerCase().includes('cancel')){console.error(error);toast('Não foi possível importar estes arquivos')}}
  }

  function observePicker(){
    const observer=new MutationObserver(()=>patchPicker());observer.observe(document.body,{childList:true,subtree:true});patchPicker();
  }
  function init(){
    buildSingleToneCard();const key=q('#nowKey');key&&new MutationObserver(updateToneCard).observe(key,{childList:true,subtree:true,characterData:true});observePicker();
    q('#nowPlaying')?.addEventListener('close',()=>stopLocalPreview());q('#padEditor')?.addEventListener('close',()=>{localPending=false});
    setTimeout(()=>{buildSingleToneCard();patchPicker()},700);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
