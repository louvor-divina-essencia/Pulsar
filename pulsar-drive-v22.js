/* PULSAR 2.2 - Drive-first audio library + Drum sound browser */
(() => {
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const drive = () => window.Capacitor?.Plugins?.NexoDrive;
  const driveAudio = () => window.Capacitor?.Plugins?.PulsarDriveAudio;
  const nativeDrive = () => !!(window.Capacitor?.isNativePlatform?.() && drive());
  let pendingDriveSelection = null;
  let pickerBank = '__ALL__';
  let pickerQuery = '';

  function token(value){
    let h=2166136261,s=String(value||'');
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
    return (h>>>0).toString(36);
  }
  function norm(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
  function displayBank(bank){return bank?.displayName||bank?.name||'Drive'}
  function fileLabel(file){return String(file?.name||'Áudio').replace(/\.[^.]+$/,'')}
  function ensureState(){state.driveOfflineAssets??={};state.driveCatalog??={lastSync:0}}
  ensureState();

  function noteForFile(file, fallbackIndex){
    try { if(typeof noteFromFilename==='function'){let found=noteFromFilename(file?.name||file?.relativePath||'');if(found)return found} } catch{}
    return tonalNotes?.[fallbackIndex%12]?.key||null;
  }

  function offlineUri(sourceId){
    let saved=state.driveOfflineAssets?.[sourceId]?.fileUri;if(saved)return saved;
    for(const bank of state.drumBanks||[])for(const pad of bank.pads||[])if(pad.driveSourceId===sourceId&&pad.nativeFileUri)return pad.nativeFileUri;
    for(const asset of state.ambientLibrary||[])if(asset.driveSourceId===sourceId&&asset.nativeFileUri)return asset.nativeFileUri;
    return null;
  }

  function syncPadCatalog(padBanks){
    for(const sourceBank of padBanks||[]){
      const bankName=displayBank(sourceBank),files=sourceBank.files||[];
      let bank=(state.ambientBanks||[]).find(b=>b.driveManaged&&norm(b.name)===norm(bankName));
      if(!bank){bank={id:`drive-pad-bank-${token(sourceBank.id||bankName)}`,name:bankName,slots:{},driveManaged:true};state.ambientBanks.push(bank)}
      bank.driveManaged=true;bank.driveCloud=true;bank.driveFileCount=files.length;bank.driveBankName=sourceBank.name;bank.slots??={};
      const used=new Set();
      files.forEach((file,index)=>{
        let asset=(state.ambientLibrary||[]).find(a=>a.driveSourceId===file.sourceId);
        if(!asset){asset={id:`drive-pad-${token(file.sourceId)}`};state.ambientLibrary.push(asset)}
        asset.name=fileLabel(file);asset.fileName=file.name||'Áudio';asset.driveSourceId=file.sourceId;asset.driveRelativePath=file.driveRelativePath||`Pads/${sourceBank.name}/${file.relativePath||file.name}`;asset.driveBankName=sourceBank.name;asset.driveManaged=true;asset.driveCloud=true;
        let local=offlineUri(file.sourceId);if(local)asset.nativeFileUri=local;
        let note=noteForFile(file,index);if(note&&!used.has(note)){bank.slots[note]=asset.id;used.add(note)}
      });
      let remaining=files.map(f=>(state.ambientLibrary||[]).find(a=>a.driveSourceId===f.sourceId)).filter(Boolean).filter(a=>!Object.values(bank.slots).includes(a.id));
      for(const note of tonalNotes||[]){if(bank.slots[note.key])continue;let asset=remaining.shift();if(!asset)break;bank.slots[note.key]=asset.id}
    }
    try{rebuildAmbientAssetIndex()}catch{}
  }

  function syncDrumCatalog(drumBanks){
    for(const sourceBank of drumBanks||[]){
      const bankName=displayBank(sourceBank),files=sourceBank.files||[];
      let bank=(state.drumBanks||[]).find(b=>b.driveManaged&&norm(b.name)===norm(bankName));
      if(!bank){bank={id:`drive-drum-bank-${token(sourceBank.id||bankName)}`,name:bankName,pads:[],driveManaged:true};state.drumBanks.push(bank)}
      const oldBySource=new Map((bank.pads||[]).filter(p=>p.driveSourceId).map(p=>[p.driveSourceId,p]));
      bank.pads=files.map((file,index)=>{
        const old=oldBySource.get(file.sourceId)||{};
        const local=offlineUri(file.sourceId)||old.nativeFileUri;
        return {
          ...old,
          name:old.name||fileLabel(file),fileName:file.name||'Áudio',driveSourceId:file.sourceId,
          driveRelativePath:file.driveRelativePath||`Drums/${sourceBank.name}/${file.relativePath||file.name}`,
          driveBankName:sourceBank.name,driveManaged:true,driveCloud:true,
          color:old.color||padColors[index%padColors.length],volume:old.volume??1,
          ...(local?{nativeFileUri:local}:{nativeFileUri:undefined})
        }
      });
      bank.driveManaged=true;bank.driveCloud=true;bank.driveFileCount=files.length;bank.driveBankName=sourceBank.name;
      if(bank.id===state.activeDrumBankId&&!editingPads)state.pads=JSON.parse(JSON.stringify(bank.pads));
    }
  }

  function syncDriveCatalog(result){
    if(!result)return;ensureState();syncPadCatalog(result.padBanks||[]);syncDrumCatalog(result.drumBanks||[]);state.driveCatalog.lastSync=Date.now();
    try{save()}catch{}
    try{renderDrums()}catch{}
    try{renderAmbientLive()}catch{}
  }

  function decorateDriveCards(){
    qa('.drive-bank').forEach(card=>{
      let kind=card.dataset.driveKind,btn=card.querySelector('button'),small=card.querySelector('small');
      if(small&&!small.textContent.includes('SINCRONIZADO'))small.textContent=small.textContent.replace(' · OFFLINE','')+' · SINCRONIZADO'+(card.classList.contains('offline')?' · OFFLINE':' · NUVEM');
      if(btn)btn.textContent=card.classList.contains('offline')?'ATUALIZAR OFFLINE':(kind==='Pads'?'DEIXAR BANCO OFFLINE':'BANCO OFFLINE');
    })
  }

  function patchDriveLibrary(){
    if(typeof renderDriveLibrary!=='function'||renderDriveLibrary.__pulsar22)return;
    const original=renderDriveLibrary;
    renderDriveLibrary=function(result){original(result);syncDriveCatalog(result);decorateDriveCards()};
    renderDriveLibrary.__pulsar22=true;
  }

  async function silentCatalogSync(){
    if(!nativeDrive())return;
    try{
      const status=await drive().getStatus();if(!status?.connected)return;
      const result=await drive().scanLibrary();
      if(typeof driveLastLibrary!=='undefined')driveLastLibrary=result;
      syncDriveCatalog(result);
      if(q('#driveConnected')&&!q('#driveConnected').hidden){try{renderDriveLibrary(result)}catch{}}
    }catch(error){console.warn('PULSAR Drive: sincronização silenciosa indisponível',error)}
  }

  function createPicker(){
    if(q('#pulsarDriveSoundPicker'))return;
    const dlg=document.createElement('dialog');dlg.id='pulsarDriveSoundPicker';dlg.className='pulsar-drive-sound-picker';
    dlg.innerHTML=`<div class="drive-picker-shell">
      <header><div><small>BIBLIOTECA PULSAR</small><h3>Escolher som do Drum</h3><p>Ouça direto do Drive e decida o que fica offline.</p></div><button id="drivePickerClose" type="button">×</button></header>
      <div class="drive-picker-source"><button class="active" type="button">☁ DRIVE</button><button id="drivePickerLocal" type="button">▣ CELULAR</button></div>
      <div class="drive-picker-tools"><label><span>⌕</span><input id="drivePickerSearch" placeholder="Buscar bumbo, caixa, loop..."></label><label class="drive-offline-choice"><input id="drivePickerOffline" type="checkbox"><span><b>OFFLINE</b><small>baixar ao escolher</small></span></label></div>
      <div id="drivePickerBanks" class="drive-picker-banks"></div>
      <div id="drivePickerList" class="drive-picker-list"></div>
      <footer><span id="drivePickerInfo">Drive é a biblioteca principal. Offline é opcional.</span><button id="drivePickerRefresh" type="button">↻ ATUALIZAR DRIVE</button></footer>
    </div>`;
    document.body.appendChild(dlg);
    q('#drivePickerClose').onclick=()=>closePicker();
    q('#drivePickerLocal').onclick=()=>{closePicker();window.__pulsarOriginalPadFilePicker?.()};
    q('#drivePickerSearch').oninput=e=>{pickerQuery=norm(e.target.value);renderPicker()};
    q('#drivePickerRefresh').onclick=()=>loadPickerLibrary(true);
    dlg.addEventListener('cancel',e=>{e.preventDefault();closePicker()});
  }

  function banksForPicker(){return (typeof driveLastLibrary!=='undefined'&&driveLastLibrary?.drumBanks)||[]}
  function renderPicker(){
    createPicker();const banks=banksForPicker(),tabs=q('#drivePickerBanks'),list=q('#drivePickerList');
    tabs.innerHTML=`<button class="${pickerBank==='__ALL__'?'active':''}" data-bank="__ALL__">TODOS</button>`+banks.map((b,i)=>`<button class="${pickerBank===String(i)?'active':''}" data-bank="${i}">${clean(displayBank(b))}<small>${b.count||0}</small></button>`).join('');
    tabs.querySelectorAll('[data-bank]').forEach(btn=>btn.onclick=()=>{pickerBank=btn.dataset.bank;renderPicker()});
    let rows=[];banks.forEach((bank,bankIndex)=>(bank.files||[]).forEach(file=>rows.push({bank,bankIndex,file})));
    if(pickerBank!=='__ALL__')rows=rows.filter(r=>String(r.bankIndex)===pickerBank);
    if(pickerQuery)rows=rows.filter(r=>norm(`${r.file.name} ${r.file.relativePath} ${displayBank(r.bank)}`).includes(pickerQuery));
    list.innerHTML=rows.length?rows.map((r,index)=>{
      const local=offlineUri(r.file.sourceId);return `<article class="drive-sound-row ${local?'offline':''}" data-row="${index}"><button class="drive-sound-preview" type="button" title="Testar">▶</button><div><b>${clean(fileLabel(r.file))}</b><small>${clean(displayBank(r.bank))}${r.file.relativePath&&r.file.relativePath!==r.file.name?' · '+clean(r.file.relativePath):''}</small></div><span>${local?'OFFLINE':'NUVEM'}</span>${local?'<button class="drive-sound-remove" type="button">REMOVER OFFLINE</button>':''}<button class="drive-sound-use" type="button">USAR</button></article>`
    }).join(''):'<div class="drive-picker-empty">Nenhum áudio encontrado com este filtro.</div>';
    list.querySelectorAll('[data-row]').forEach((el,index)=>{
      const row=rows[index];
      el.querySelector('.drive-sound-preview').onclick=()=>previewDriveFile(row.file);
      el.querySelector('.drive-sound-use').onclick=()=>chooseDriveFile(row.bank,row.file);
      el.querySelector('.drive-sound-remove')?.addEventListener('click',()=>removeOfflineFile(row.file));
    });
    q('#drivePickerInfo').textContent=`${rows.length} áudio${rows.length===1?'':'s'} disponível${rows.length===1?'':'is'} · toque em ▶ para ouvir`;
  }

  async function loadPickerLibrary(force=false){
    createPicker();q('#drivePickerList').innerHTML='<div class="drive-picker-loading"><i></i><b>Lendo biblioteca do Drive…</b></div>';
    try{
      if(force||!banksForPicker().length){const result=await drive().scanLibrary();if(typeof driveLastLibrary!=='undefined')driveLastLibrary=result;syncDriveCatalog(result)}
      renderPicker();
    }catch(error){console.error(error);q('#drivePickerList').innerHTML='<div class="drive-picker-empty">Não foi possível ler o Drive. Verifique a pasta conectada.</div>'}
  }
  async function openPicker(){
    if(!nativeDrive())return toast('O navegador do Drive está disponível no APK Android');
    createPicker();pickerBank='__ALL__';pickerQuery='';q('#drivePickerSearch').value='';q('#pulsarDriveSoundPicker').showModal();await loadPickerLibrary(false)
  }
  async function closePicker(){try{await driveAudio()?.stopPreview()}catch{}q('#pulsarDriveSoundPicker')?.close()}
  async function previewDriveFile(file){
    try{qa('.drive-sound-preview.playing').forEach(b=>b.classList.remove('playing'));let btn=[...qa('.drive-sound-row')].find(r=>r.querySelector('b')?.textContent===fileLabel(file))?.querySelector('.drive-sound-preview');btn?.classList.add('playing');await driveAudio().preview({sourceId:file.sourceId,volume:1});setTimeout(()=>btn?.classList.remove('playing'),2500)}catch(error){console.error(error);toast('Não foi possível testar este áudio do Drive')}
  }
  async function chooseDriveFile(bank,file){
    let local=offlineUri(file.sourceId),wantOffline=!!q('#drivePickerOffline')?.checked;
    try{
      if(wantOffline&&!local){q('#drivePickerInfo').textContent='Baixando este som para uso offline…';const cached=await driveAudio().cacheAsset({sourceId:file.sourceId,name:file.name,kind:'drum',bankName:displayBank(bank)});local=cached.fileUri;state.driveOfflineAssets[file.sourceId]={fileUri:local,name:file.name,bankName:displayBank(bank),cachedAt:Date.now()};save()}
      pendingDriveSelection={...file,bankName:displayBank(bank),localUri:local||null};
      q('#padFileName').textContent=(local?'✓ OFFLINE · ':'☁ DRIVE · ')+(file.name||'Áudio');
      let source=q('#padDriveSourceHint');if(source)source.textContent=local?'Disponível offline':'No Drive · será necessário internet para prévia';
      await closePicker();toast(local?'Som escolhido e disponível offline':'Som escolhido do Drive')
    }catch(error){console.error(error);toast('Não foi possível preparar este som')}
  }
  async function removeOfflineFile(file){
    const local=offlineUri(file.sourceId);if(!local)return;
    try{await driveAudio()?.removeCached({fileUri:local});delete state.driveOfflineAssets[file.sourceId];
      for(const bank of state.drumBanks||[])for(const p of bank.pads||[])if(p.driveSourceId===file.sourceId)delete p.nativeFileUri;
      for(const a of state.ambientLibrary||[])if(a.driveSourceId===file.sourceId)delete a.nativeFileUri;
      if(currentDrumBank()?.id===state.activeDrumBankId){let b=currentDrumBank();state.pads=JSON.parse(JSON.stringify(b.pads||[]))}
      save();renderPicker();try{renderDrums();renderAmbientLive()}catch{}toast('Cópia offline removida. O som continua no Drive')
    }catch(error){console.error(error);toast('Não foi possível remover a cópia offline')}
  }

  function patchPadEditor(){
    const choose=q('#choosePadFile'),preview=q('#previewPad'),saveButton=q('#savePad');if(!choose||!preview||!saveButton||choose.dataset.pulsar22)return;
    choose.dataset.pulsar22='1';
    const originalChoose=choose.onclick,originalPreview=preview.onclick,originalSave=saveButton.onclick;
    window.__pulsarOriginalPadFilePicker=()=>originalChoose?.call(choose,new Event('click'));
    choose.textContent='BIBLIOTECA PULSAR';choose.onclick=()=>openPicker();
    const slot=choose.closest('.file-slot');if(slot&&!q('#choosePadLocal')){let local=document.createElement('button');local.id='choosePadLocal';local.type='button';local.className='load-sample secondary-local';local.textContent='CELULAR';local.onclick=()=>window.__pulsarOriginalPadFilePicker?.();slot.appendChild(local);let hint=document.createElement('small');hint.id='padDriveSourceHint';hint.className='pad-drive-source-hint';hint.textContent='Drive ou armazenamento local';slot.querySelector('div')?.appendChild(hint)}
    try{const oldEdit=editPad;editPad=function(i){pendingDriveSelection=null;oldEdit(i);let hint=q('#padDriveSourceHint'),p=state.pads[i];if(hint)hint.textContent=p?.driveSourceId?(p.nativeFileUri?'Drive · offline':'Drive · nuvem'):'Drive ou armazenamento local'}}catch{}
    preview.onclick=async function(e){if(!pendingDriveSelection)return originalPreview?.call(preview,e);try{await driveAudio().preview({sourceId:pendingDriveSelection.sourceId,volume:Math.min(1,+q('#padVolume').value||1)});q('.mini-meter')?.classList.add('playing');setTimeout(()=>q('.mini-meter')?.classList.remove('playing'),2200)}catch(error){console.error(error);toast('Não foi possível testar este som')}};
    saveButton.onclick=async function(e){
      if(!pendingDriveSelection)return originalSave?.call(saveButton,e);
      let p=state.pads[editorIndex];if(!p)return;
      try{
        if(p.driveSourceId&&p.nativeFileUri&&p.driveSourceId!==pendingDriveSelection.sourceId)await driveAudio()?.removeCached({fileUri:p.nativeFileUri}).catch(()=>{});
        else if(!p.driveSourceId){try{await removePadAsset(p)}catch{}}
        p.name=q('#padName').value.trim()||fileLabel(pendingDriveSelection);p.color=q('#padColor').value;p.volume=+q('#padVolume').value;
        p.fileName=pendingDriveSelection.name||'Áudio';p.driveSourceId=pendingDriveSelection.sourceId;p.driveRelativePath=pendingDriveSelection.driveRelativePath||pendingDriveSelection.relativePath;p.driveBankName=pendingDriveSelection.bankName;p.driveManaged=true;p.driveCloud=true;
        delete p.audioKey;delete p.buffer;if(pendingDriveSelection.localUri)p.nativeFileUri=pendingDriveSelection.localUri;else delete p.nativeFileUri;
        let bank=currentDrumBank();if(bank)bank.pads=JSON.parse(JSON.stringify(state.pads));save();pendingDriveSelection=null;resetPendingPadFile();renderDrums();q('#padEditor').close();toast('Pad salvo com áudio do Drive')
      }catch(error){console.error(error);toast('Não foi possível salvar este áudio do Drive')}
    }
  }

  function organizePlayer(){
    const player=q('#player');if(!player)return;player.classList.add('player-organized-v22');
    const status=q('#playerNativeStatus');if(status){status.title='Motor Android ativo · reprodução em segundo plano';status.classList.add('player-engine-compact')}
    const summary=q('.library-summary-v16');if(summary&&status&&!summary.querySelector('.player-engine-dot')){let dot=document.createElement('span');dot.className='player-engine-dot';dot.innerHTML='<i></i>ANDROID';summary.appendChild(dot)}
  }

  patchDriveLibrary();patchPadEditor();organizePlayer();setTimeout(silentCatalogSync,900);
  window.addEventListener('focus',()=>{if(Date.now()-(state.driveCatalog?.lastSync||0)>10*60*1000)silentCatalogSync()},{passive:true});
})();
