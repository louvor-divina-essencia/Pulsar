/* PULSAR 2.3 — player limpo, Drum fixo, Drive-first e Studio */
(() => {
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const esc = value => typeof clean === 'function' ? clean(value) : String(value ?? '').replace(/[&<>"']/g, '');
  const media = () => window.Capacitor?.Plugins?.MediaLibrary;

  // -----------------------------
  // PLAYER: visual limpo + somente TOM como transformação
  // -----------------------------
  function disableUnusedPlayerFx(){
    try {
      state.playerSettings.speed = 1;
      state.playerSettings.eqEnabled = false;
      state.playerSettings.bass = 0;
      state.playerSettings.reverb = 0;
      state.playerSettings.virtualizer = 0;
      save();
      media()?.setPlayback?.({ pitch: Number(state.playerSettings.pitch) || 0, speed: 1 }).catch(()=>{});
      media()?.setEqualizerEnabled?.({ enabled:false }).catch(()=>{});
      media()?.setBassBoost?.({ strength:0 }).catch(()=>{});
      media()?.setVirtualizer?.({ strength:0 }).catch(()=>{});
      media()?.setReverb?.({ strength:0 }).catch(()=>{});
    } catch(e) { console.warn('PULSAR 2.3: não foi possível zerar FX', e); }
  }

  function analysisOf(track){
    try { return state.trackAnalysis?.[trackKey(track)] || null; } catch { return null; }
  }

  function installProfessionalTrackRows(){
    if(typeof renderSongs !== 'function' || renderSongs.__p23) return;
    renderSongs = function(filter = q('#songLibrarySearch')?.value || ''){
      const el=q('#songList'), query=searchFold(filter); let rows=query?playlist.map((s,i)=>({s,i})):baseRowsForCollection();
      if(query) rows=rows.filter(({s})=>searchFold(`${s.name} ${s.artist||''} ${s.album||''} ${s.folder||''} ${s.fileName||''}`).includes(query));
      currentRenderedRows=rows; updateCounts(); el.classList.toggle('empty',!rows.length); el.classList.toggle('selection-mode',selectionMode);
      if(query){ q('#libraryViewTitle').textContent='Resultados'; q('#libraryViewSubtitle').textContent=`${rows.length} música${rows.length===1?'':'s'} encontrada${rows.length===1?'':'s'}`; }
      el.innerHTML = rows.length ? rows.map(({s,i},position)=>{
        const selected=selectedTrackIds.has(trackKey(s)), insidePlaylist=activeCollection?.type==='playlist'&&!query, a=analysisOf(s);
        const artist=s.artist&&s.artist!=='<unknown>'?s.artist:'Artista desconhecido';
        const album=s.album&&s.album!=='<unknown>'?s.album:'';
        const tech=[a?.bpm?`${Math.round(a.bpm)} BPM`:'',a?.key?`TOM ${a.key}`:''].filter(Boolean).join(' · ');
        return `<div class="track-row track-row-v23 ${i===songIndex?'playing':''} ${selected?'selected':''}" data-i="${i}">
          <button class="track-select ${selectionMode?'show':''}" type="button" data-select="${i}" aria-label="Selecionar ${esc(s.name)}"><span>${selected?'✓':''}</span></button>
          <span class="track-number">${String(position+1).padStart(2,'0')}</span>
          <span class="track-copy"><b title="${esc(s.name)}">${esc(s.name)}</b><small>${esc(artist)}${album?' · '+esc(album):''}</small>${tech?`<em>${esc(tech)}</em>`:''}</span>
          <span class="track-duration">${fmt((s.duration||0)/1000)}</span>
          <button class="track-more ${insidePlaylist?'remove':''}" data-more="${i}" title="${insidePlaylist?'Remover da playlist':'Adicionar à playlist'}">${insidePlaylist?'−':'＋'}</button>
        </div>`;
      }).join('') : '<div class="player-empty-v23"><b>Nenhuma música aqui</b><span>Atualize a biblioteca ou mude o filtro.</span></div>';
      el.querySelectorAll('.track-row').forEach(r=>r.onclick=e=>{if(e.target.closest('.track-more,.track-select'))return;let i=+r.dataset.i;if(selectionMode){toggleTrackSelection(playlist[i]);r.classList.toggle('selected',selectedTrackIds.has(trackKey(playlist[i])));r.querySelector('.track-select span').textContent=selectedTrackIds.has(trackKey(playlist[i]))?'✓':'';return}loadSong(i,true,rows)});
      el.querySelectorAll('.track-select').forEach(b=>b.onclick=e=>{e.stopPropagation();let i=+b.dataset.select;if(!selectionMode)selectionMode=true;toggleTrackSelection(playlist[i]);renderSongs(filter)});
      el.querySelectorAll('.track-more').forEach(b=>b.onclick=e=>{e.stopPropagation();let i=+b.dataset.more;if(activeCollection?.type==='playlist'&&!query)removeTrackFromActivePlaylist(trackKey(playlist[i]));else openPlaylistDialog(i)});
      updateSelectionUi();renderPlayerContextActions();
    };
    renderSongs.__p23=true;
  }

  function cleanPlayerDom(){
    q('#player')?.classList.add('player-professional-v23');
    q('#equalizerDialog')?.remove();
    ['#openEq','#tabletEq','#nowEq'].forEach(s=>q(s)?.remove());
    // controles de velocidade deixam de existir na experiência visual
    ['#nowSpeed','#nowSpeedValue','#tabletSpeed','#tabletSpeedValue'].forEach(s=>{let el=q(s);let label=el?.closest?.('label');if(label)label.remove();else el?.remove()});
    // capa decorativa grande não ocupa mais espaço
    q('.player-focus-art')?.remove();
    q('.tablet-now-art')?.remove();
    q('.now-art')?.remove();
    // motor Android vira indicador discreto
    const status=q('#playerNativeStatus'); if(status) status.hidden=true;
    const title=q('.player-title-copy p'); if(title) title.textContent='Biblioteca, tom e reprodução. Sem distrações.';
    const search=q('#songLibrarySearch'); if(search) search.placeholder='Buscar música, artista ou álbum';
    const summary=q('.library-summary-v16'); if(summary){let small=summary.querySelector('small');if(small)small.textContent='Toque em uma faixa para reproduzir';}
    disableUnusedPlayerFx();
  }

  // -----------------------------
  // DRUM: 6 pads base fixos, sons escolhidos manualmente
  // -----------------------------
  function blankPad(i){ return {name:`PAD ${i+1}`,color:padColors[i%padColors.length],volume:1}; }
  function sanitizeDrumBanks(){
    try{
      state.drumBanks ??=[];
      // Catálogo do Drive não vira banco de pads automaticamente. Ele continua disponível no seletor.
      let locals=state.drumBanks.filter(b=>!b.driveManaged);
      let bank=locals.find(b=>b.id===state.activeDrumBankId)||locals[0];
      if(!bank){ bank={id:`drum-main-${Date.now()}`,name:'MEUS PADS',pads:[],driveManaged:false}; locals=[bank]; }
      bank.driveManaged=false; bank.name=bank.name||'MEUS PADS'; bank.pads=Array.isArray(bank.pads)?bank.pads:[];
      while(bank.pads.length<6) bank.pads.push(blankPad(bank.pads.length));
      // preserva pads extras adicionados manualmente; remove apenas bancos automáticos do Drive
      state.drumBanks=locals;
      state.activeDrumBankId=bank.id;
      state.pads=JSON.parse(JSON.stringify(bank.pads));
      save();
      if(typeof renderDrums==='function') renderDrums();
      const count=q('#drumBankCount'); if(count) count.textContent=`${state.pads.length} PADS · 6 BASE`;
    }catch(e){console.warn('PULSAR 2.3: ajuste dos drums',e)}
  }

  function patchDriveRendering(){
    if(typeof renderDriveLibrary!=='function'||renderDriveLibrary.__p23)return;
    const previous=renderDriveLibrary;
    renderDriveLibrary=function(result){ previous(result); sanitizeDrumBanks(); };
    renderDriveLibrary.__p23=true;
  }

  function cleanDrumDom(){
    q('#drums')?.classList.add('drums-fixed-v23');
    q('.drum-master')?.remove();
    q('#importDrumSounds')?.remove();
    q('#drumBankFiles')?.remove();
    q('#drumBankTabs')?.remove();
    const quick=q('#drums .drive-quickbar b'); if(quick) quick.textContent='Escolha sons do Drive dentro de cada Pad';
    const open=q('#openDriveDrums'); if(open) open.textContent='VER CATÁLOGO';
    const hint=q('#drums .hint'); if(hint) hint.textContent='Toque em EDITAR, escolha um Pad e abra BIBLIOTECA PULSAR. Você pode ouvir cada timbre antes de usar. O botão + NOVO PAD continua disponível.';
    const add=q('#addDrumPad'); if(add) add.textContent='＋ NOVO PAD';
  }

  // -----------------------------
  // BIBLIOTECA: Drive como fonte principal; remover fluxo LAN da interface
  // -----------------------------
  function simplifyLibrary(){
    q('#syncDialog')?.classList.add('library-drive-only-v23');
    q('.sync-primary-actions')?.remove();
    q('#syncSharePanel')?.remove();
    q('#syncReceivePanel')?.remove();
    q('.sync-backup-row')?.remove();
    q('#firstRunCopy')?.remove();
    const summary=q('.sync-summary'); if(summary) summary.remove();
    const head=q('#syncDialog .sync-head'); if(head){let small=head.querySelector('small'),h=head.querySelector('h2'),p=head.querySelector('p');if(small)small.textContent='PULSAR CLOUD';if(h)h.textContent='Biblioteca';if(p)p.textContent='Drive é o acervo principal. O app sincroniza o catálogo e você escolhe o que fica offline.';}
    const dhead=q('.drive-sync-head p');if(dhead)dhead.textContent='Depois da primeira conexão, o catálogo é atualizado automaticamente ao abrir o PULSAR.';
    const foot=q('.sync-footnote');if(foot)foot.textContent='Os arquivos permanecem no Drive. Baixe somente bancos ou timbres que você precisa usar sem internet.';
    const open=q('#openSync');if(open){open.textContent='☁';open.title='Biblioteca PULSAR';}
    qa('.drive-config-actions button').forEach((b,i)=>{ if(i<2)b.remove(); });
  }

  // -----------------------------
  // STUDIO: gravador multitrack leve (fase 1)
  // -----------------------------
  const studio={recorder:null,stream:null,chunks:[],startedAt:0,timer:null,currentAudio:null};
  function studioDb(){
    return new Promise((resolve,reject)=>{const req=indexedDB.open('pulsar-studio',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('takes'))req.result.createObjectStore('takes',{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  }
  async function storeTake(take){const db=await studioDb();return new Promise((resolve,reject)=>{const tx=db.transaction('takes','readwrite');tx.objectStore('takes').put(take);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
  async function listTakes(){const db=await studioDb();return new Promise((resolve,reject)=>{const tx=db.transaction('takes');const req=tx.objectStore('takes').getAll();req.onsuccess=()=>{db.close();resolve((req.result||[]).sort((a,b)=>b.createdAt-a.createdAt))};req.onerror=()=>reject(req.error)})}
  async function deleteTake(id){const db=await studioDb();return new Promise((resolve,reject)=>{const tx=db.transaction('takes','readwrite');tx.objectStore('takes').delete(id);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
  function formatClock(ms){let sec=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`}

  function injectStudio(){
    if(q('#studio'))return;
    const homeGrid=q('.pulsar-tool-grid');
    if(homeGrid){const btn=document.createElement('button');btn.className='tool-tile tool-studio-v23';btn.dataset.go='studio';btn.innerHTML='<span class="tool-glyph">●</span><span class="tool-copy"><small>GRAVAÇÃO</small><b>Studio</b></span>';homeGrid.appendChild(btn);btn.onclick=()=>go('studio')}
    const main=q('main');if(!main)return;
    const section=document.createElement('section');section.id='studio';section.className='page studio-page-v23';section.innerHTML=`
      <div class="page-title studio-title"><button class="back" type="button">‹</button><div><small>PULSAR STUDIO · BETA</small><h2>Gravador</h2><p>Registre voz ou instrumento e toque junto com uma música ou bateria.</p></div></div>
      <div class="studio-guide-card"><div><small>MÚSICA GUIA</small><b id="studioGuideName">Nenhuma música selecionada</b><span>Use o Player como base enquanto grava.</span></div><button id="studioGuidePlay" type="button">▶ GUIA</button></div>
      <div class="studio-rec-card"><div class="studio-rec-status"><span id="studioRecLight"></span><div><small id="studioRecState">PRONTO</small><b id="studioRecTime">00:00</b></div></div><button id="studioRecord" class="studio-record-button" type="button"><i></i><b>GRAVAR</b></button><p>Para gravar só sua voz/instrumento, use fone de ouvido. O Player e o Drum podem continuar tocando enquanto a gravação está ativa.</p></div>
      <div class="studio-shortcuts"><button id="studioOpenPlayer" type="button">▶ ABRIR PLAYER</button><button id="studioOpenDrums" type="button">◉ ABRIR DRUM</button></div>
      <div class="studio-takes-head"><div><small>CAMADAS GRAVADAS</small><h3>Takes</h3></div><span id="studioTakeCount">0</span></div>
      <div id="studioTakes" class="studio-takes"><div class="studio-empty">Nenhum take gravado ainda.</div></div>`;
    main.appendChild(section);
    section.querySelector('.back').onclick=()=>go('home');
    q('#studioGuidePlay').onclick=()=>{ if(!currentTrack())return toast('Escolha uma música no Player primeiro'); q('#playerFocusPlay')?.click(); updateStudioGuide(); };
    q('#studioOpenPlayer').onclick=()=>go('player');
    q('#studioOpenDrums').onclick=()=>go('drums');
    q('#studioRecord').onclick=toggleRecording;
    updateStudioGuide();renderStudioTakes();
  }

  function updateStudioGuide(){
    const el=q('#studioGuideName');if(!el)return;try{const t=currentTrack();el.textContent=t?`${t.name} · ${t.artist||'Artista desconhecido'}`:'Nenhuma música selecionada';q('#studioGuidePlay').textContent=playerPlaying?'Ⅱ GUIA':'▶ GUIA'}catch{}
  }

  async function toggleRecording(){ if(studio.recorder?.state==='recording') return stopRecording(); return startRecording(); }
  async function startRecording(){
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return toast('Gravação não disponível neste aparelho');
      studio.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      studio.chunks=[];let mime='';for(const candidate of ['audio/webm;codecs=opus','audio/webm','audio/mp4'])if(MediaRecorder.isTypeSupported?.(candidate)){mime=candidate;break}
      studio.recorder=new MediaRecorder(studio.stream,mime?{mimeType:mime}:undefined);
      studio.recorder.ondataavailable=e=>{if(e.data?.size)studio.chunks.push(e.data)};
      studio.recorder.onstop=finalizeRecording;
      studio.startedAt=Date.now();studio.recorder.start(250);
      q('#studioRecState').textContent='GRAVANDO';q('#studioRecLight').classList.add('on');q('#studioRecord').classList.add('recording');q('#studioRecord b').textContent='PARAR';
      clearInterval(studio.timer);studio.timer=setInterval(()=>{const t=q('#studioRecTime');if(t)t.textContent=formatClock(Date.now()-studio.startedAt)},250);
    }catch(e){console.error(e);toast('Autorize o microfone para usar o Studio')}
  }
  function stopRecording(){try{studio.recorder?.stop()}catch{};clearInterval(studio.timer);studio.stream?.getTracks?.().forEach(t=>t.stop());studio.stream=null;q('#studioRecState').textContent='SALVANDO';q('#studioRecLight').classList.remove('on');q('#studioRecord').classList.remove('recording');q('#studioRecord b').textContent='GRAVAR'}
  async function finalizeRecording(){
    try{const blob=new Blob(studio.chunks,{type:studio.recorder?.mimeType||'audio/webm'});if(!blob.size)throw new Error('empty');const createdAt=Date.now(),duration=Date.now()-studio.startedAt;await storeTake({id:`take-${createdAt}`,name:`Take ${new Date(createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`,blob,type:blob.type,createdAt,duration});q('#studioRecState').textContent='PRONTO';q('#studioRecTime').textContent='00:00';await renderStudioTakes();toast('Take salvo no PULSAR Studio')}catch(e){console.error(e);q('#studioRecState').textContent='ERRO';toast('Não foi possível salvar a gravação')}finally{studio.chunks=[];studio.recorder=null}}
  async function renderStudioTakes(){
    const list=q('#studioTakes');if(!list)return;try{const takes=await listTakes();q('#studioTakeCount').textContent=takes.length;list.innerHTML=takes.length?takes.map(t=>`<article class="studio-take" data-id="${t.id}"><button class="studio-take-play" type="button">▶</button><div><b>${esc(t.name)}</b><small>${formatClock(t.duration)} · ${new Date(t.createdAt).toLocaleDateString('pt-BR')}</small></div><button class="studio-take-delete" type="button">×</button></article>`).join(''):'<div class="studio-empty">Nenhum take gravado ainda.</div>';list.querySelectorAll('.studio-take').forEach((row,index)=>{const t=takes[index];row.querySelector('.studio-take-play').onclick=()=>playTake(t,row);row.querySelector('.studio-take-delete').onclick=async()=>{await deleteTake(t.id);renderStudioTakes()}})}catch(e){console.error(e);list.innerHTML='<div class="studio-empty">Não foi possível abrir os takes.</div>'}
  }
  function playTake(take,row){try{if(studio.currentAudio){studio.currentAudio.pause();studio.currentAudio=null;qa('.studio-take.playing').forEach(x=>x.classList.remove('playing'))}const url=URL.createObjectURL(take.blob),audio=new Audio(url);studio.currentAudio=audio;row.classList.add('playing');audio.onended=()=>{row.classList.remove('playing');URL.revokeObjectURL(url);if(studio.currentAudio===audio)studio.currentAudio=null};audio.play()}catch(e){console.error(e);toast('Não foi possível tocar este take')}}

  function observeCurrentSong(){
    const target=q('#playerFocusTitle')||q('#nowTitle');if(!target)return;new MutationObserver(updateStudioGuide).observe(target,{childList:true,subtree:true,characterData:true});
  }

  // Identidade visual discreta
  function polishIdentity(){document.body.classList.add('pulsar-identity-v23');const homeTitle=q('.home-command-head h1');if(homeTitle)homeTitle.textContent='Central';}

  function init(){
    cleanPlayerDom();installProfessionalTrackRows();
    cleanDrumDom();patchDriveRendering();sanitizeDrumBanks();setTimeout(sanitizeDrumBanks,1500);setTimeout(sanitizeDrumBanks,3500);
    simplifyLibrary();injectStudio();observeCurrentSong();polishIdentity();
    window.addEventListener('focus',()=>setTimeout(sanitizeDrumBanks,1200),{passive:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
