const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let audioCtx, currentPage='home', playlist=[], songIndex=-1, taps=[], metroTimer, nextNoteTime=0, beat=0, editingPads=false, selectedLyric=null;
const song=new Audio(); song.preload='auto';
const state=JSON.parse(localStorage.getItem('up-state')||'{}');
const padColors=['#22d3ee','#a78bfa','#fb923c','#3ee89c','#f472b6','#facc15'];
state.pads??=Array.from({length:6},(_,i)=>({name:`PAD ${i+1}`,color:padColors[i%padColors.length],volume:1}));state.pads.forEach((p,i)=>{p.volume??=1;p.color??=padColors[i%padColors.length];p.repeat??=false;p.repeatBeats??=1});state.drumBanks??=[];if(!state.drumBanks.length)state.drumBanks.push({id:`drum-bank-${Date.now()}`,name:'MEU BANCO',pads:JSON.parse(JSON.stringify(state.pads)),driveManaged:false});state.activeDrumBankId??=state.drumBanks[0]?.id;if(!state.drumBanks.some(b=>b.id===state.activeDrumBankId))state.activeDrumBankId=state.drumBanks[0]?.id;state.lyrics??=[];state.accents??=[3,1,1,1];state.bank??='air';state.playerFavorites??=[];state.playerRecent??=[];state.playerPlaylists??=[];state.playerImports??=[];state.trackAnalysis??={};state.playerSettings??={repeat:0,shuffle:false,volume:.9,pitch:0,speed:1,eqEnabled:false,eqPreset:'flat',eqBands:[]};state.playerSettings.repeat??=0;state.playerSettings.shuffle??=false;state.playerSettings.volume??=.9;state.playerSettings.pitch??=0;state.playerSettings.speed??=1;state.playerSettings.eqEnabled??=false;state.playerSettings.eqPreset??='flat';state.playerSettings.eqBands??=[];state.playerSettings.bass??=0;state.playerSettings.reverb??=0;state.playerSettings.virtualizer??=0;state.drumLoopRate??=1;state.ambientPads??=[];state.ambientLibrary??=[];state.ambientBanks??=[];state.ambientSettings??={volume:.7};state.ambientSettings.volume??=.7;state.ambientSettings.fade=.8;state.ambientSettings.cutoff=100;state.metroSettings??={clickVolume:1.15};state.metroSettings.clickVolume??=1.15;state.playerUi??={};state.playerUi.miniCollapsed??=false;state.playerUi.miniPosition??=null;
const save=()=>{try{let activeDrum=(state.drumBanks||[]).find(b=>b.id===state.activeDrumBankId);if(activeDrum)activeDrum.pads=JSON.parse(JSON.stringify(state.pads||[]));localStorage.setItem('up-state',JSON.stringify(state));return true}catch(error){console.error(error);toast('Não foi possível salvar: armazenamento cheio');return false}};
const tonalNotes=[
  {key:'C',label:'C'},{key:'Cs',label:'C#'},{key:'D',label:'D'},{key:'Eb',label:'Eb'},
  {key:'E',label:'E'},{key:'F',label:'F'},{key:'Fs',label:'F#'},{key:'G',label:'G'},
  {key:'Ab',label:'Ab'},{key:'A',label:'A'},{key:'Bb',label:'Bb'},{key:'B',label:'B'}
];
function migrateAmbientV15(){
  let changed=false;
  if(!state.ambientMigration15){
    const known=new Set(state.ambientLibrary.map(a=>a.nativeFileUri||a.audioKey||a.fileName));
    for(const [i,p] of (state.ambientPads||[]).entries()){
      const signature=p.nativeFileUri||p.audioKey||p.fileName;if(!signature||known.has(signature))continue;
      state.ambientLibrary.push({id:`legacy-${Date.now()}-${i}`,name:p.name||String(p.fileName||`Pad ${i+1}`).replace(/\.[^.]+$/,''),fileName:p.fileName||p.name||`Pad ${i+1}`,nativeFileUri:p.nativeFileUri,audioKey:p.audioKey});known.add(signature);changed=true;
    }
    state.ambientMigration15=true;changed=true;
  }
  state.ambientLibrary.forEach((a,i)=>{if(!a.id){a.id=`ambient-${Date.now()}-${i}`;changed=true}});
  if(!state.ambientBanks.length){state.ambientBanks.push({id:`bank-${Date.now()}`,name:'WARM',slots:{}});changed=true}
  state.ambientBanks.forEach(b=>{b.slots??={}});
  if(!state.activeAmbientBankId||!state.ambientBanks.some(b=>b.id===state.activeAmbientBankId)){state.activeAmbientBankId=state.ambientBanks[0].id;changed=true}
  if(changed)save();
}
migrateAmbientV15();

function updateViewportMetrics(){const v=window.visualViewport,h=Math.round(v?.height||window.innerHeight),w=Math.round(v?.width||window.innerWidth);document.documentElement.style.setProperty('--nexo-vh',h+'px');document.documentElement.style.setProperty('--nexo-vw',w+'px')}
updateViewportMetrics();window.addEventListener('resize',updateViewportMetrics,{passive:true});window.addEventListener('orientationchange',()=>setTimeout(updateViewportMetrics,120),{passive:true});window.visualViewport?.addEventListener('resize',updateViewportMetrics,{passive:true});

function ctx(){if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended')audioCtx.resume(); return audioCtx}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),1800)}
function clampMiniPlayerPosition(savePosition=false){
  let mini=$('#miniPlayer'),pos=state.playerUi?.miniPosition;if(!mini||!pos)return;
  let rect=mini.getBoundingClientRect(),pad=8,dockGap=92;
  let maxX=Math.max(pad,window.innerWidth-rect.width-pad),maxY=Math.max(pad,window.innerHeight-rect.height-dockGap);
  pos.x=Math.max(pad,Math.min(+pos.x||pad,maxX));pos.y=Math.max(pad,Math.min(+pos.y||pad,maxY));
  mini.classList.add('custom-position');mini.style.left=pos.x+'px';mini.style.top=pos.y+'px';mini.style.right='auto';mini.style.bottom='auto';
  if(savePosition)save();
}
function restoreMiniPlayerPosition(){let mini=$('#miniPlayer');if(!mini)return;mini.classList.toggle('collapsed',!!state.playerUi?.miniCollapsed);$('#miniCollapse').textContent=state.playerUi?.miniCollapsed?'□':'−';$('#miniCollapse').title=state.playerUi?.miniCollapsed?'Expandir Player':'Recolher Player';if(state.playerUi?.miniPosition)requestAnimationFrame(()=>clampMiniPlayerPosition(false))}
function syncMiniPlayerVisibility(){let mini=$('#miniPlayer');if(!mini)return;let embedded=currentPage==='player'||currentPage==='metronome',available=!!(currentTrack()&&(playerBackend!=='none'||playerPlaying||playerDuration>0));mini.classList.toggle('context-hidden',embedded);mini.hidden=embedded||!available;if(!mini.hidden)restoreMiniPlayerPosition()}
function openFloatingNowPlaying(){if(!currentTrack())return toast('Escolha uma música primeiro');$('#miniPlayer').hidden=true;$('#nowPlaying').showModal()}
function minimizePlayerUi(){if(!currentTrack())return toast('Escolha uma música primeiro');if($('#nowPlaying')?.open)$('#nowPlaying').close();go('home');requestAnimationFrame(()=>{syncMiniPlayerVisibility();let mini=$('#miniPlayer');if(mini){mini.hidden=false;restoreMiniPlayerPosition();mini.classList.remove('mini-pop');void mini.offsetWidth;mini.classList.add('mini-pop')}})}
function initMiniPlayerDrag(){
  let mini=$('#miniPlayer'),handle=$('#miniDrag');if(!mini||!handle)return;let drag=null;
  handle.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;e.preventDefault();let r=mini.getBoundingClientRect();drag={id:e.pointerId,dx:e.clientX-r.left,dy:e.clientY-r.top};handle.setPointerCapture?.(e.pointerId);mini.classList.add('dragging','custom-position');mini.style.transform='none'});
  handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;e.preventDefault();let pad=8,dockGap=92,w=mini.offsetWidth,h=mini.offsetHeight,maxX=Math.max(pad,window.innerWidth-w-pad),maxY=Math.max(pad,window.innerHeight-h-dockGap),x=Math.max(pad,Math.min(e.clientX-drag.dx,maxX)),y=Math.max(pad,Math.min(e.clientY-drag.dy,maxY));mini.style.left=x+'px';mini.style.top=y+'px';mini.style.right='auto';mini.style.bottom='auto';state.playerUi.miniPosition={x,y}});
  const finish=e=>{if(!drag||e.pointerId!==drag.id)return;mini.classList.remove('dragging');try{handle.releasePointerCapture?.(e.pointerId)}catch{}drag=null;clampMiniPlayerPosition(true)};
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
  $('#miniCollapse').onclick=e=>{e.stopPropagation();state.playerUi.miniCollapsed=!state.playerUi.miniCollapsed;mini.classList.toggle('collapsed',state.playerUi.miniCollapsed);$('#miniCollapse').textContent=state.playerUi.miniCollapsed?'□':'−';$('#miniCollapse').title=state.playerUi.miniCollapsed?'Expandir Player':'Recolher Player';save();requestAnimationFrame(()=>clampMiniPlayerPosition(false))};
  window.addEventListener('resize',()=>requestAnimationFrame(()=>clampMiniPlayerPosition(false)),{passive:true});
  window.addEventListener('orientationchange',()=>setTimeout(()=>clampMiniPlayerPosition(false),180),{passive:true});
  restoreMiniPlayerPosition();
}
function go(id){currentPage=id;$$('.page').forEach(x=>{let active=x.id===id;x.classList.toggle('active',active);if(active){x.classList.remove('page-reenter');requestAnimationFrame(()=>x.classList.add('page-reenter'))}});$$('.dock button').forEach(x=>x.classList.toggle('active',x.dataset.go===id));scrollTo(0,0);syncMiniPlayerVisibility();if(id==='ambient'){padDecodedCache.clear();padRawCache.clear()}if(id==='metronome')syncMetroTrackUi();if(id==='player'&&!playlist.length&&window.Capacitor?.isNativePlatform?.())setTimeout(()=>$('#scanDeviceMusic')?.click(),250)}
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));$$('.back').forEach(b=>b.onclick=()=>go('home'));
$('#fullscreenBtn').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
const fmt=n=>!isFinite(n)?'0:00':`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
const mediaLibrary=()=>window.Capacitor?.Plugins?.MediaLibrary;
const clean=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let playerView='tracks',activeCollection=null,playerPlaying=false,playerPosition=0,playerDuration=0,abA=null,abB=null,eqInfo=null,nativePlaybackUnavailable=false,nativeFallbackActive=false,fallbackStarting=false,selectionMode=false,playlistPendingTrackIds=[],playerBackend='none',playbackSwitchId=0,playlistSelectionTargetId=null,currentRenderedRows=[],nativeActiveQueueIds=[],restoredEqTrackId='';
const selectedTrackIds=new Set();
const isNativePlayer=()=>!!(window.Capacitor?.isNativePlatform?.()&&mediaLibrary());
const usingNativePlayback=()=>isNativePlayer()&&playerBackend==='native';
const trackKey=t=>String(t?.id||t?.nativeUri||t?.name||'');
function nativeQueue(tracks=playlist){return tracks.filter(t=>t?.nativeUri).map(t=>({id:trackKey(t),uri:t.nativeUri,title:t.name,artist:t.artist,album:t.album,duration:t.duration||0}))}
function updateCounts(){$('#libraryCount').textContent=`${playlist.length} ${playlist.length===1?'MÚSICA':'MÚSICAS'}`;$('#favoriteCount').textContent=`${state.playerFavorites.length} músicas`;$('#recentCount').textContent=`${state.playerRecent.length} músicas`}
function currentTrack(){return playlist[songIndex]||null}
function rememberRecent(track){if(!track)return;let id=trackKey(track);state.playerRecent=[id,...state.playerRecent.filter(x=>x!==id)].slice(0,100);save();updateCounts()}
function setPlayerEngineBadge(label,active=false){let badge=$('#playerEngineBadge'),box=$('#playerNativeStatus');if(badge)badge.textContent=label;if(box)box.classList.toggle('active',!!active)}
function searchFold(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
function baseRowsForCollection(){let rows=playlist.map((s,i)=>({s,i}));if(activeCollection?.type==='favorites')rows=rows.filter(({s})=>state.playerFavorites.includes(trackKey(s)));if(activeCollection?.type==='recent')rows=state.playerRecent.map(id=>rows.find(({s})=>trackKey(s)===id)).filter(Boolean);if(activeCollection?.type==='added')rows.sort((a,b)=>(b.s.dateAdded||0)-(a.s.dateAdded||0));if(activeCollection?.type==='group')rows=rows.filter(({s})=>String(s[activeCollection.field]||'Desconhecido')===activeCollection.value);if(activeCollection?.type==='playlist'){let ids=activeCollection.list.trackIds||[];rows=ids.map(id=>rows.find(({s})=>trackKey(s)===id)).filter(Boolean)}return rows}
function updateSelectionUi(){let count=selectedTrackIds.size,bar=$('#selectionBar'),toggle=$('#toggleTrackSelection'),target=(state.playerPlaylists||[]).find(x=>String(x.id)===String(playlistSelectionTargetId));if(bar){bar.hidden=!selectionMode;$('#selectionCount').textContent=target?`${count} selecionada${count===1?'':'s'} para ${target.name}`:`${count} ${count===1?'música':'músicas'}`;$('#selectionAddPlaylist').disabled=count===0;$('#selectionAddPlaylist').textContent=target?'ADICIONAR':'＋ PLAYLIST'}if(toggle){toggle.classList.toggle('active',selectionMode);toggle.textContent=selectionMode?'CONCLUIR':'SELECIONAR'}}
function setSelectionMode(on,keepTarget=false){selectionMode=!!on;if(!selectionMode){selectedTrackIds.clear();if(!keepTarget)playlistSelectionTargetId=null}updateSelectionUi();if(playerView==='tracks'||activeCollection||$('#songLibrarySearch')?.value.trim())renderSongs()}
function toggleTrackSelection(track){let id=trackKey(track);selectedTrackIds.has(id)?selectedTrackIds.delete(id):selectedTrackIds.add(id);updateSelectionUi()}
function renderPlayerContextActions(){let el=$('#playerContextActions');if(!el)return;let html='';if(playerView==='playlists'&&!activeCollection){html='<button type="button" data-player-action="new-playlist">＋ NOVA PLAYLIST</button>'}else if(activeCollection?.type==='playlist'){html='<button type="button" data-player-action="play-list">▶ TOCAR</button><button type="button" data-player-action="add-list">＋ MÚSICAS</button><button type="button" data-player-action="delete-list" class="danger">EXCLUIR</button>'}else if(currentRenderedRows.length){html='<button type="button" data-player-action="play-visible">▶ TOCAR LISTA</button>'}el.innerHTML=html;el.hidden=!html;el.querySelector('[data-player-action="new-playlist"]')?.addEventListener('click',()=>openNewPlaylistDialog([]));el.querySelector('[data-player-action="play-list"]')?.addEventListener('click',()=>{let rows=baseRowsForCollection();if(!rows.length)return toast('Esta playlist está vazia');loadSong(rows[0].i,true,rows)});el.querySelector('[data-player-action="play-visible"]')?.addEventListener('click',()=>{let rows=currentRenderedRows;if(!rows.length)return;loadSong(rows[0].i,true,rows)});el.querySelector('[data-player-action="add-list"]')?.addEventListener('click',()=>beginAddToPlaylist(activeCollection.list));el.querySelector('[data-player-action="delete-list"]')?.addEventListener('click',()=>deleteActivePlaylist())}
function renderSongs(filter=$('#songLibrarySearch')?.value||''){
  const el=$('#songList'),q=searchFold(filter);let rows=q?playlist.map((s,i)=>({s,i})):baseRowsForCollection();
  if(q)rows=rows.filter(({s})=>searchFold(`${s.name} ${s.artist||''} ${s.album||''} ${s.folder||''} ${s.fileName||''}`).includes(q));
  currentRenderedRows=rows;updateCounts();el.classList.toggle('empty',!rows.length);el.classList.toggle('selection-mode',selectionMode);
  if(q){$('#libraryViewTitle').textContent='Resultados';$('#libraryViewSubtitle').textContent=`${rows.length} música${rows.length===1?'':'s'} encontrada${rows.length===1?'':'s'}`}
  el.innerHTML=rows.length?rows.map(({s,i})=>{let selected=selectedTrackIds.has(trackKey(s)),insidePlaylist=activeCollection?.type==='playlist'&&!q;return `<div class="track-row ${i===songIndex?'playing':''} ${selected?'selected':''}" data-i="${i}"><button class="track-select ${selectionMode?'show':''}" type="button" data-select="${i}" aria-label="Selecionar ${clean(s.name)}"><span>${selected?'✓':''}</span></button><span class="track-art">${i===songIndex&&playerPlaying?'Ⅱ':'♪'}</span><span class="track-copy"><b>${clean(s.name)}</b><small>${clean(s.artist||'Artista desconhecido')} · ${clean(s.album||'Álbum desconhecido')}</small></span><span class="track-duration">${fmt((s.duration||0)/1000)}</span><button class="track-more ${insidePlaylist?'remove':''}" data-more="${i}" title="${insidePlaylist?'Remover da playlist':'Adicionar à playlist'}">${insidePlaylist?'−':'＋'}</button></div>`}).join(''):'Nenhum item encontrado.';
  el.querySelectorAll('.track-row').forEach(r=>r.onclick=e=>{if(e.target.closest('.track-more,.track-select'))return;let i=+r.dataset.i;if(selectionMode){toggleTrackSelection(playlist[i]);r.classList.toggle('selected',selectedTrackIds.has(trackKey(playlist[i])));r.querySelector('.track-select span').textContent=selectedTrackIds.has(trackKey(playlist[i]))?'✓':'';return}loadSong(i,true,rows)});
  el.querySelectorAll('.track-select').forEach(b=>b.onclick=e=>{e.stopPropagation();let i=+b.dataset.select;if(!selectionMode)selectionMode=true;toggleTrackSelection(playlist[i]);renderSongs(filter)});
  el.querySelectorAll('.track-more').forEach(b=>b.onclick=e=>{e.stopPropagation();let i=+b.dataset.more;if(activeCollection?.type==='playlist'&&!q)removeTrackFromActivePlaylist(trackKey(playlist[i]));else openPlaylistDialog(i)});updateSelectionUi();renderPlayerContextActions();
}
function renderGroups(field,icon){let groups=new Map();playlist.forEach(s=>{let name=String(s[field]||'Desconhecido');groups.set(name,(groups.get(name)||0)+1)});currentRenderedRows=[];let el=$('#songList');el.classList.toggle('empty',!groups.size);el.innerHTML=groups.size?`<div class="group-grid">${[...groups].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,count])=>`<button class="group-card" data-group="${clean(name)}"><i>${icon}</i><b>${clean(name)}</b><small>${count} músicas</small></button>`).join('')}</div>`:'Nenhum grupo encontrado.';el.querySelectorAll('.group-card').forEach(b=>b.onclick=()=>{activeCollection={type:'group',field,value:b.dataset.group};$('#libraryViewTitle').textContent=b.dataset.group;$('#libraryViewSubtitle').textContent='Toque em uma música para iniciar esta fila';$('#toggleTrackSelection').hidden=false;renderSongs()});renderPlayerContextActions()}
function renderPlaylists(){let el=$('#songList'),lists=state.playerPlaylists;currentRenderedRows=[];el.classList.toggle('empty',!lists.length);el.innerHTML=lists.length?`<div class="group-grid playlist-grid-v20">${lists.map(x=>`<button class="group-card playlist-card-v20" data-list="${x.id}"><i>☷</i><b>${clean(x.name)}</b><small>${x.trackIds.length} músicas</small><span>ABRIR ›</span></button>`).join('')}</div>`:'<div class="playlist-empty-v20"><b>Nenhuma playlist ainda</b><span>Crie uma lista e adicione várias músicas de uma vez.</span></div>';el.querySelectorAll('.group-card').forEach(b=>b.onclick=()=>{let list=lists.find(x=>String(x.id)===b.dataset.list);activeCollection={type:'playlist',list};$('#libraryViewTitle').textContent=list.name;$('#libraryViewSubtitle').textContent='A próxima música seguirá somente esta playlist';$('#toggleTrackSelection').hidden=false;renderSongs()});renderPlayerContextActions()}
function renderPlayerView(resetCollection=true){if(resetCollection)activeCollection=null;if(selectionMode)setSelectionMode(false);$('#toggleTrackSelection').hidden=playerView!=='tracks';$('#smartCollections').hidden=playerView!=='tracks';let names={tracks:['Todas as faixas','Toque para reproduzir · + adiciona à playlist'],playlists:['Suas playlists','Crie, abra e toque listas completas'],folders:['Pastas','Organização original do armazenamento'],albums:['Álbuns','Músicas agrupadas por álbum'],artists:['Artistas','Músicas agrupadas por artista']};$('#libraryViewTitle').textContent=names[playerView][0];$('#libraryViewSubtitle').textContent=names[playerView][1];if(playerView==='tracks')renderSongs('');if(playerView==='playlists')renderPlaylists();if(playerView==='folders')renderGroups('folder','▰');if(playerView==='albums')renderGroups('album','◉');if(playerView==='artists')renderGroups('artist','♬')}
$$('#playerTabs button').forEach(b=>b.onclick=()=>{$$('#songLibrarySearch').value='';$('#clearPlayerSearch').hidden=true;$$('#playerTabs button').forEach(x=>x.classList.toggle('active',x===b));playerView=b.dataset.view;playlistSelectionTargetId=null;renderPlayerView(true)});
$('#toggleTrackSelection').onclick=()=>setSelectionMode(!selectionMode);
$('#selectionCancel').onclick=()=>{let target=playlistSelectionTargetId;setSelectionMode(false);if(target){let list=state.playerPlaylists.find(x=>String(x.id)===String(target));if(list){playerView='playlists';$$('#playerTabs button').forEach(x=>x.classList.toggle('active',x.dataset.view==='playlists'));activeCollection={type:'playlist',list};$('#libraryViewTitle').textContent=list.name;renderSongs()}}};
$('#selectionAddPlaylist').onclick=()=>{let ids=[...selectedTrackIds];if(!ids.length)return toast('Selecione pelo menos uma música');if(playlistSelectionTargetId){let list=state.playerPlaylists.find(x=>String(x.id)===String(playlistSelectionTargetId));if(!list)return;for(let id of ids)if(!list.trackIds.includes(id))list.trackIds.push(id);save();let qty=ids.length;setSelectionMode(false,true);playlistSelectionTargetId=null;playerView='playlists';$$('#playerTabs button').forEach(x=>x.classList.toggle('active',x.dataset.view==='playlists'));activeCollection={type:'playlist',list};$('#libraryViewTitle').textContent=list.name;$('#libraryViewSubtitle').textContent='A próxima música seguirá somente esta playlist';renderSongs();toast(`${qty} música${qty===1?'':'s'} adicionada${qty===1?'':'s'}`);return}openPlaylistDialog(-1,ids)};
$$('#smartCollections button').forEach(b=>b.onclick=()=>{activeCollection={type:b.dataset.smart};$('#libraryViewTitle').textContent={favorites:'Músicas favoritas',recent:'Reproduções recentes',added:'Últimas adições'}[b.dataset.smart];$('#libraryViewSubtitle').textContent='Toque em uma música para iniciar esta fila';renderSongs('')});
$('#songLibrarySearch').oninput=e=>{let q=e.target.value;$('#clearPlayerSearch').hidden=!q.trim();if(q.trim()){activeCollection=null;$('#smartCollections').hidden=true;$('#toggleTrackSelection').hidden=false;renderSongs(q)}else{renderPlayerView(true)}};
$('#clearPlayerSearch').onclick=()=>{$('#songLibrarySearch').value='';$('#clearPlayerSearch').hidden=true;renderPlayerView(true);$('#songLibrarySearch').focus()};
function normalizedPlayerImports(){return (state.playerImports||[]).filter(x=>x&&x.nativeUri).map((x,i)=>({id:x.id||`import-${i}-${x.nativeUri}`,name:x.name||x.fileName||'Áudio importado',artist:x.artist||'Arquivo local',album:'Importado no Pulsar',folder:'Importados',duration:x.duration||0,dateAdded:x.dateAdded||Date.now(),fileName:x.fileName||x.name||'',nativeUri:x.nativeUri,imported:true}))}
function mergePersistentPlayerImports(){let existing=new Set(playlist.map(t=>String(t.nativeUri||'')));for(let t of normalizedPlayerImports())if(t.nativeUri&&!existing.has(String(t.nativeUri))){playlist.push(t);existing.add(String(t.nativeUri))}}
async function importPlayerFilesNative(){try{let result=await mediaLibrary().pickAudioFiles({multiple:true}),files=result?.files||[];if(!files.length)return;for(let f of files){let uri=f.fileUri;if(!uri)continue;let found=(state.playerImports||[]).find(x=>x.nativeUri===uri);if(found)continue;let name=String(f.name||'Áudio importado').replace(/\.[^.]+$/,'');state.playerImports.push({id:`import-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name,fileName:f.name||name,nativeUri:uri,dateAdded:Date.now()})}save();mergePersistentPlayerImports();renderPlayerView(false);updateCounts();toast(`${files.length} arquivo${files.length===1?'':'s'} importado${files.length===1?'':'s'}`)}catch(err){let msg=String(err?.message||err||'');if(!/cancel/i.test(msg)){console.error(err);toast('Não foi possível importar os arquivos')}}}
$('#importPlayerFiles').onclick=()=>{if(isNativePlayer()&&mediaLibrary()?.pickAudioFiles)importPlayerFilesNative();else $('#songInput').click()};
$('#songInput').onchange=async e=>{for(const f of e.target.files)playlist.push({id:'file-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),name:f.name.replace(/\.[^.]+$/,''),artist:'Arquivo local',album:'Importado manualmente',folder:'Importados',duration:0,url:URL.createObjectURL(f),file:f});e.target.value='';renderPlayerView(false)};
async function applyNativeSettings(){if(!isNativePlayer())return;let p=mediaLibrary(),s=state.playerSettings;await p.setVolume({volume:s.volume});await p.setPlayback({pitch:s.pitch,speed:s.speed});await p.setRepeat({mode:s.repeat});await p.setShuffle({enabled:s.shuffle});await p.setEqualizerEnabled({enabled:s.eqEnabled})}
async function syncNativeQueue(){return applyNativeSettings()}
async function setPlayerVolume(v,persist=true){v=Math.max(0,Math.min(1,+v||0));state.playerSettings.volume=v;song.volume=v;['#songVolume','#nowVolume','#metroMusicVolume','#tabletVolume'].forEach(sel=>{let el=$(sel);if(el)el.value=v});['#volumeValue','#nowVolumeValue','#metroMusicVolumeValue','#tabletVolumeValue'].forEach(sel=>{let el=$(sel);if(el)el.textContent=Math.round(v*100)+'%'});try{if(isNativePlayer())await mediaLibrary().setVolume({volume:v})}catch(e){console.warn(e)}if(persist)save()}
function stopWebPlayback(clearSource=false){try{if(!song.paused)song.pause()}catch(e){console.warn(e)}if(clearSource){try{song.removeAttribute('src');song.load()}catch(e){console.warn(e)}}}
async function stopNativePlayback(){if(!isNativePlayer())return;try{await mediaLibrary().stop()}catch(e){console.warn('Falha ao encerrar o player nativo',e)}}
async function stopAllPlayback(){++playbackSwitchId;stopWebPlayback(true);await stopNativePlayback();playerBackend='none';playerPlaying=false;nativeActiveQueueIds=[];updatePlay()}
function syncMetroTrackUi(){let t=currentTrack(),name=$('#metroTrackName');if(name)name.textContent=t?`${t.name} · ${t.artist||'Artista desconhecido'}`:'Nenhuma música selecionada';let b=$('#metroMusicPlay');if(b)b.textContent=playerPlaying?'Ⅱ':'▶'}
async function startNativeContext(track,rows,autoplay=true){let tracks=(rows||[]).map(r=>r.s||r).filter(Boolean);if(!tracks.some(t=>trackKey(t)===trackKey(track)))tracks=[track,...tracks];let nativeTracks=tracks.filter(t=>t.nativeUri);if(!nativeTracks.length)throw new Error('Nenhuma música nativa nesta fila');nativeActiveQueueIds=nativeTracks.map(trackKey);let queue=nativeQueue(nativeTracks),nativeIndex=nativeActiveQueueIds.indexOf(trackKey(track));if(nativeIndex<0)throw new Error('Música não encontrada na fila');stopWebPlayback(true);playerBackend='native';nativeFallbackActive=false;await mediaLibrary().setQueue({songs:queue});await applyNativeSettings();await mediaLibrary().playIndex({index:nativeIndex,autoplay})}
async function switchToWeb(track,autoplay=true){++playbackSwitchId;await stopNativePlayback();playerBackend='web';nativeActiveQueueIds=[];if(!track.url&&track.nativeUri){let r=await mediaLibrary().prepareSong({uri:track.nativeUri,id:trackKey(track),fileName:track.fileName||track.name});track.url=window.Capacitor.convertFileSrc(r.fileUri)}if(!track.url)throw new Error('Arquivo sem endereço local');song.src=track.url;song.volume=state.playerSettings.volume;song.preservesPitch=true;song.playbackRate=state.playerSettings.speed||1;song.load();if(autoplay)await song.play()}
async function playCompatible(track,autoplay=true){fallbackStarting=true;try{await switchToWeb(track,autoplay)}finally{fallbackStarting=false}}
async function loadSong(i,autoplay=false,rows=null){if(!playlist.length)return;songIndex=(i+playlist.length)%playlist.length;let track=currentTrack();rememberRecent(track);updateTrackUI(track);playerPlaying=false;updatePlay();try{if(isNativePlayer()&&track.nativeUri&&!nativePlaybackUnavailable){await startNativeContext(track,rows?.length?rows:currentRenderedRows,autoplay)}else await playCompatible(track,autoplay)}catch(err){console.error(err);playerPlaying=false;setPlayerEngineBadge('ERRO');toast('Não foi possível abrir esta música')}updatePlay()}
function updateTrackAnalysisUI(track){let analysis=track?state.trackAnalysis[trackKey(track)]:null,bpm=analysis?.bpm?`BPM ≈ ${analysis.bpm}`:'BPM —',key=analysis?.key?`TOM ≈ ${analysis.key}`:'TOM —';['#playerFocusBpm','#nowBpm'].forEach(s=>{let el=$(s);if(el)el.textContent=bpm});['#playerFocusKey','#nowKey'].forEach(s=>{let el=$(s);if(el)el.textContent=key});$('#bpmResult').textContent=analysis?.bpm||'—';$('#keyResult').textContent=analysis?.key||'—'}
function updateTrackUI(track,reveal=false){if(!track)return;$('#songTitle').textContent=track.name;$('#songMeta').textContent=`${track.artist||'Artista desconhecido'} • ${track.album||'Álbum desconhecido'}`;$('#miniTitle').textContent=track.name;$('#miniMeta').textContent=track.artist||'Artista desconhecido';$('#nowTitle').textContent=track.name;$('#nowArtist').textContent=track.artist||'Artista desconhecido';$('#nowAlbum').textContent=track.album||'Álbum desconhecido';$('#nowSource').textContent=track.folder||'Biblioteca local';if($('#lyricsTrackName'))$('#lyricsTrackName').textContent=`${track.name} • ${track.artist||'Artista desconhecido'}`;if($('#tabletNowTitle'))$('#tabletNowTitle').textContent=track.name;if($('#tabletNowMeta'))$('#tabletNowMeta').textContent=`${track.artist||'Artista desconhecido'} · ${track.album||'Álbum desconhecido'}`;if(reveal&&currentPage!=='player'&&currentPage!=='metronome')$('#miniPlayer').hidden=false;$('#favoriteSong').classList.toggle('active',state.playerFavorites.includes(trackKey(track)));$('#favoriteSong').textContent=state.playerFavorites.includes(trackKey(track))?'♥':'♡';let focus=$('#playerFocusCard');if(focus){focus.hidden=false;$('#playerFocusTitle').textContent=track.name;$('#playerFocusMeta').textContent=`${track.artist||'Artista desconhecido'} · ${track.album||'Álbum desconhecido'}`}updateTrackAnalysisUI(track);syncMetroTrackUi()}
function updateProgress(pos,dur){playerPosition=pos||0;playerDuration=dur||0;let value=dur?1000*pos/dur:0;$('#songSeek').value=value;$('#nowSeek').value=value;$('#currentTime').textContent=$('#nowCurrent').textContent=fmt(pos/1000);$('#duration').textContent=$('#nowDuration').textContent=fmt(dur/1000);$('#miniProgress').style.width=(value/10)+'%';if(abA!==null&&abB!==null&&pos>=abB)seekPlayer(abA)}
function refreshTrackPlaybackState(){let list=$('#songList');if(!list)return;list.querySelectorAll('.track-row').forEach(r=>{let on=+r.dataset.i===songIndex;r.classList.toggle('playing',on);let art=r.querySelector('.track-art');if(art)art.textContent=on&&playerPlaying?'Ⅱ':'♪'})}
function updatePlay(){$('#playSong').textContent=playerPlaying?'Ⅱ':'▶';$('#miniPlay').textContent=playerPlaying?'Ⅱ':'▶';$('#nowPlay').textContent=playerPlaying?'Ⅱ':'▶';if($('#playerFocusPlay'))$('#playerFocusPlay').textContent=playerPlaying?'Ⅱ':'▶';if($('#tabletPlay'))$('#tabletPlay').textContent=playerPlaying?'Ⅱ':'▶';setPlayerEngineBadge(playerPlaying?'TOCANDO':currentTrack()?'PAUSADO':'PRONTO',playerPlaying);syncMetroTrackUi();refreshTrackPlaybackState()}
async function togglePlayer(){if(songIndex<0)return toast('Escolha uma música');try{let shouldPlay=!playerPlaying;if(usingNativePlayback())await mediaLibrary()[shouldPlay?'play':'pause']();else if(playerBackend==='web')shouldPlay?await song.play():song.pause();else return loadSong(songIndex,true,currentRenderedRows);playerPlaying=shouldPlay;if(shouldPlay&&currentPage!=='player'&&currentPage!=='metronome')$('#miniPlayer').hidden=false;updatePlay()}catch(err){console.error(err);playerPlaying=false;updatePlay();toast('Falha ao reproduzir esta música')}}
async function seekPlayer(ms){try{if(usingNativePlayback())await mediaLibrary().seek({position:Math.max(0,ms)});else song.currentTime=Math.max(0,ms/1000)}catch(err){console.error(err);toast('Não foi possível avançar nesta música')}}
async function skipPlayer(direction){try{if(usingNativePlayback())await mediaLibrary().skip({direction});else if(playerBackend==='web')await loadSong(songIndex+direction,true,currentRenderedRows)}catch(err){console.error(err);playerPlaying=false;updatePlay();toast('Não foi possível trocar de música')}}
async function restoreStateFromNative(){if(!isNativePlayer())return;try{let data=await mediaLibrary().getState();applyNativeState(data)}catch(e){console.warn(e)}}
function applyNativeState(data){if(!data)return;if(Array.isArray(data.queueIds)&&data.queueIds.length)nativeActiveQueueIds=data.queueIds.map(String);if(data.id){playerBackend='native';let i=playlist.findIndex(x=>trackKey(x)===String(data.id));if(i>=0&&i!==songIndex){songIndex=i;let t=playlist[i];rememberRecent(t);updateTrackUI(t)}}playerPlaying=!!data.playing;updateProgress(data.position||0,data.duration||0);if(data.id&&(data.duration||0)>0){if(currentPage!=='player'&&currentPage!=='metronome')$('#miniPlayer').hidden=false;restoreNativeMix(String(data.id))}updatePlay()}
$('#scanDeviceMusic').onclick=async()=>{let plugin=mediaLibrary();if(!plugin)return toast('A biblioteca do celular funciona no APK');let b=$('#scanDeviceMusic'),old=b.textContent;b.disabled=true;b.textContent='LENDO...';try{let result=await plugin.getSongs();let currentId=currentTrack()?trackKey(currentTrack()):null;playlist=(result.songs||[]).map(s=>({id:s.id,name:s.title||s.fileName||'Sem título',artist:s.artist||'Artista desconhecido',album:s.album||'Álbum desconhecido',folder:s.folder||'Músicas',duration:s.duration||0,dateAdded:s.dateAdded||0,fileName:s.fileName||'',nativeUri:s.uri}));mergePersistentPlayerImports();songIndex=currentId?playlist.findIndex(t=>trackKey(t)===currentId):-1;relinkSyncedLibraryReferences();renderPlayerView(false);await restoreStateFromNative();toast(`${playlist.length} músicas organizadas`)}catch(err){console.error(err);toast(String(err?.message||err).toLowerCase().includes('permission')?'Permissão de áudio não concedida':'Não foi possível ler as músicas')}finally{b.disabled=false;b.textContent=old}};
$('#playSong').onclick=$('#miniPlay').onclick=$('#nowPlay').onclick=togglePlayer;$('#playerFocusPlay').onclick=togglePlayer;$('#playerFocusOpen').onclick=openFloatingNowPlaying;$('#metroMusicPlay').onclick=togglePlayer;$('#prevSong').onclick=$('#nowPrev').onclick=()=>skipPlayer(-1);$('#nextSong').onclick=$('#nowNext').onclick=()=>skipPlayer(1);$('#back10').onclick=$('#nowBack10').onclick=()=>seekPlayer(playerPosition-10000);$('#forward10').onclick=$('#nowForward10').onclick=()=>seekPlayer(playerPosition+10000);
$('#songSeek').oninput=$('#nowSeek').oninput=e=>seekPlayer(playerDuration*+e.target.value/1000);$('#songVolume').oninput=$('#nowVolume').oninput=$('#metroMusicVolume').oninput=e=>setPlayerVolume(+e.target.value);let playbackApplyTimer=null,lastPitchWarning=0;async function applyPlaybackMix(){let s=state.playerSettings;if(usingNativePlayback()){try{let result=await mediaLibrary().setPlayback({pitch:s.pitch,speed:s.speed});let ok=result?.applied!==false;$('#nowPitch').classList.toggle('unsupported',!ok&&playerDuration>0);if(!ok&&playerDuration>0&&Date.now()-lastPitchWarning>3000){lastPitchWarning=Date.now();toast('Este formato/aparelho recusou o ajuste de tom')}}catch(err){console.warn(err)}}else{song.preservesPitch=true;song.playbackRate=s.speed||1;$('#nowPitch').classList.add('unsupported')}}function queuePlaybackMix(){clearTimeout(playbackApplyTimer);playbackApplyTimer=setTimeout(applyPlaybackMix,70)}$('#pitch').oninput=$('#nowPitch').oninput=e=>{let v=+e.target.value;state.playerSettings.pitch=v;$('#pitchValue').textContent=$('#nowPitchValue').textContent=(v>0?'+':'')+v+' st';if($('#tabletPitchValue'))$('#tabletPitchValue').textContent=(v>0?'+':'')+v+' st';if($('#tabletPitch'))$('#tabletPitch').value=v;queuePlaybackMix();save()};$('#nowSpeed').oninput=e=>{let v=+e.target.value;state.playerSettings.speed=v;$('#nowSpeedValue').textContent=Math.round(v*100)+'%';if($('#tabletSpeedValue'))$('#tabletSpeedValue').textContent=Math.round(v*100)+'%';if($('#tabletSpeed'))$('#tabletSpeed').value=v;queuePlaybackMix();save()};
song.onloadedmetadata=()=>{if(playerBackend==='web'&&currentPage!=='player'&&currentPage!=='metronome')$('#miniPlayer').hidden=false};song.onplay=()=>{if(playerBackend!=='web'){stopWebPlayback();return}playerPlaying=true;if(currentPage!=='player'&&currentPage!=='metronome')$('#miniPlayer').hidden=false;updatePlay()};song.onpause=()=>{if(playerBackend!=='web')return;playerPlaying=false;updatePlay()};song.onerror=()=>{if(playerBackend!=='web')return;playerPlaying=false;updatePlay();toast('Falha ao reproduzir esta música')};song.ontimeupdate=()=>{if(playerBackend==='web')updateProgress(song.currentTime*1000,(song.duration||0)*1000)};song.onended=()=>{if(playerBackend==='web')skipPlayer(1)};
$('#miniOpen').onclick=openFloatingNowPlaying;$('#closeNow').onclick=()=>{$('#nowPlaying').close();syncMiniPlayerVisibility()};$('#minimizeNow').onclick=minimizePlayerUi;$('#minimizePagePlayer').onclick=minimizePlayerUi;initMiniPlayerDrag();$('#openEq').onclick=$('#nowEq').onclick=()=>openEqualizer();$('#closeEq').onclick=()=>$('#equalizerDialog').close();$('#miniQueue').onclick=$('#openQueue').onclick=()=>{renderQueue();$('#queueDialog').showModal()};$('#closeQueue').onclick=()=>$('#queueDialog').close();
$('#favoriteSong').onclick=()=>{let t=currentTrack();if(!t)return;let id=trackKey(t),on=state.playerFavorites.includes(id);state.playerFavorites=on?state.playerFavorites.filter(x=>x!==id):[...state.playerFavorites,id];save();updateTrackUI(t);updateCounts();toast(on?'Removida das favoritas':'Adicionada às favoritas')};
$('#shuffleSong').onclick=async()=>{state.playerSettings.shuffle=!state.playerSettings.shuffle;$('#shuffleSong').classList.toggle('active',state.playerSettings.shuffle);if(isNativePlayer())await mediaLibrary().setShuffle({enabled:state.playerSettings.shuffle});save()};$('#repeatSong').onclick=async()=>{state.playerSettings.repeat=(state.playerSettings.repeat+1)%3;let labels=['Repetição desligada','Repetir esta música','Repetir a fila atual'];$('#repeatSong').textContent=state.playerSettings.repeat===1?'↻¹':'↻';$('#repeatSong').classList.toggle('active',state.playerSettings.repeat>0);if(isNativePlayer())await mediaLibrary().setRepeat({mode:state.playerSettings.repeat});save();toast(labels[state.playerSettings.repeat])};
$('#loopA').onclick=()=>{abA=playerPosition;abB=null;$('#loopA').classList.add('active');$('#loopB').classList.remove('active');$('#abLoopStatus').textContent=`Ponto A: ${fmt(abA/1000)} — marque o ponto B`};$('#loopB').onclick=()=>{if(abA===null)return toast('Marque primeiro o ponto A');abB=playerPosition;if(abB<=abA+1000){abB=null;return toast('O ponto B precisa ficar depois do A')}$('#loopB').classList.add('active');$('#abLoopStatus').textContent=`Repetindo ${fmt(abA/1000)} até ${fmt(abB/1000)}`};$('#abLoopStatus').onclick=()=>{abA=abB=null;$('#loopA').classList.remove('active');$('#loopB').classList.remove('active');$('#abLoopStatus').textContent='Loop A–B desligado'};
function activeQueueTracks(){let ids=nativeActiveQueueIds.length?nativeActiveQueueIds:currentRenderedRows.map(({s})=>trackKey(s));return ids.map(id=>playlist.find(t=>trackKey(t)===id)).filter(Boolean)}
function renderQueue(){let tracks=activeQueueTracks(),el=$('#queueList');el.classList.toggle('empty',!tracks.length);el.innerHTML=tracks.length?tracks.map((t,i)=>`<div class="queue-row ${trackKey(t)===trackKey(currentTrack())?'playing':''}" data-id="${clean(trackKey(t))}"><span>${String(i+1).padStart(2,'0')}</span><div><b>${clean(t.name)}</b><small>${clean(t.artist||'Artista desconhecido')}</small></div><button>▶</button></div>`).join(''):'A fila está vazia.';el.querySelectorAll('.queue-row').forEach(r=>r.onclick=()=>{let tracksNow=activeQueueTracks(),t=playlist.find(x=>trackKey(x)===r.dataset.id),i=t?playlist.indexOf(t):-1;if(i<0)return;$('#queueDialog').close();loadSong(i,true,tracksNow.map(s=>({s,i:playlist.indexOf(s)})))})}
function closePlaylistDialog(){playlistPendingTrackIds=[];$('#playlistDialog').close()}
function finishPlaylistSelection(){if(selectionMode)setSelectionMode(false)}
function openPlaylistDialog(index=songIndex,ids=null){let trackIds=(ids||[]).filter(Boolean);if(!trackIds.length&&index>=0&&playlist[index])trackIds=[trackKey(playlist[index])];playlistPendingTrackIds=[...new Set(trackIds)];$('#playlistDialogTitle').textContent=playlistPendingTrackIds.length>1?`Adicionar ${playlistPendingTrackIds.length} músicas`:'Adicionar à playlist';renderPlaylistChoices();$('#playlistDialog').showModal()}
function openNewPlaylistDialog(ids=[]){playlistPendingTrackIds=[...new Set(ids.filter(Boolean))];$('#newPlaylistName').value='';$('#newPlaylistDialog').showModal();setTimeout(()=>$('#newPlaylistName').focus(),80)}
function saveNewPlaylist(){let name=$('#newPlaylistName').value.trim();if(!name)return toast('Digite um nome para a playlist');let ids=[...playlistPendingTrackIds];let list={id:Date.now(),name,trackIds:ids};state.playerPlaylists.push(list);save();$('#newPlaylistDialog').close();if($('#playlistDialog').open)$('#playlistDialog').close();playlistPendingTrackIds=[];finishPlaylistSelection();playerView='playlists';$$('#playerTabs button').forEach(x=>x.classList.toggle('active',x.dataset.view==='playlists'));activeCollection={type:'playlist',list};$('#songLibrarySearch').value='';$('#clearPlayerSearch').hidden=true;$('#libraryViewTitle').textContent=list.name;$('#libraryViewSubtitle').textContent='A próxima música seguirá somente esta playlist';renderSongs();toast('Playlist criada')}
$('#nowAddPlaylist').onclick=()=>openPlaylistDialog(songIndex);$('#closePlaylist').onclick=closePlaylistDialog;$('#createPlaylist').onclick=()=>openNewPlaylistDialog(playlistPendingTrackIds);$('#closeNewPlaylist').onclick=$('#cancelNewPlaylist').onclick=()=>{$('#newPlaylistDialog').close();if(!$('#playlistDialog').open)playlistPendingTrackIds=[]};$('#saveNewPlaylist').onclick=saveNewPlaylist;$('#newPlaylistName').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();saveNewPlaylist()}};
function renderPlaylistChoices(){let el=$('#playlistChoices'),qty=playlistPendingTrackIds.length;el.innerHTML=state.playerPlaylists.length?state.playerPlaylists.map(x=>`<button class="playlist-choice" data-id="${x.id}"><div><b>${clean(x.name)}</b><small>${x.trackIds.length} músicas</small></div><span>＋</span></button>`).join(''):'<p class="hint">Nenhuma playlist ainda. Crie a primeira acima.</p>';el.querySelectorAll('.playlist-choice').forEach(r=>r.onclick=()=>{let list=state.playerPlaylists.find(x=>String(x.id)===r.dataset.id);if(!list)return;for(let id of playlistPendingTrackIds)if(!list.trackIds.includes(id))list.trackIds.push(id);save();closePlaylistDialog();finishPlaylistSelection();toast(`${qty||1} música${qty===1?'':'s'} adicionada${qty===1?'':'s'} à playlist`)})}
function beginAddToPlaylist(list){if(!list)return;playlistSelectionTargetId=list.id;selectedTrackIds.clear();selectionMode=true;activeCollection=null;playerView='tracks';$('#songLibrarySearch').value='';$('#clearPlayerSearch').hidden=true;$$('#playerTabs button').forEach(x=>x.classList.toggle('active',x.dataset.view==='tracks'));$('#smartCollections').hidden=false;$('#toggleTrackSelection').hidden=false;$('#libraryViewTitle').textContent=`Adicionar em ${list.name}`;$('#libraryViewSubtitle').textContent='Marque as músicas e toque em ADICIONAR';renderSongs('');updateSelectionUi()}
function removeTrackFromActivePlaylist(id){let list=activeCollection?.list;if(!list)return;list.trackIds=(list.trackIds||[]).filter(x=>String(x)!==String(id));save();renderSongs();toast('Música removida da playlist')}
function deleteActivePlaylist(){let list=activeCollection?.list;if(!list)return;if(!confirm(`Excluir a playlist "${list.name}"? As músicas não serão apagadas.`))return;state.playerPlaylists=state.playerPlaylists.filter(x=>String(x.id)!==String(list.id));save();activeCollection=null;renderPlaylists();$('#libraryViewTitle').textContent='Suas playlists';$('#libraryViewSubtitle').textContent='Crie, abra e toque listas completas';toast('Playlist excluída')}
function normalizeSongName(v){return String(v||'').toLowerCase().replace(/\.[a-z0-9]{2,5}$/,'').replace(/\([^)]*\)|\[[^\]]*\]/g,' ').replace(/\b(feat|ft|ao vivo|live|playback|oficial|official)\b.*$/,' ').replace(/[^a-z0-9à-ÿ]+/g,' ').trim()}
function lyricForTrack(t){if(!t)return null;let key=trackKey(t),name=normalizeSongName(t.name);return state.lyrics.find(x=>x.trackId===key)||state.lyrics.find(x=>normalizeSongName(x.title)===name)||null}
$('#nowLyrics').onclick=()=>{let t=currentTrack();if(!t)return toast('Escolha uma música primeiro');let x=lyricForTrack(t);$('#nowPlaying').close();if(x)return openLyric(x.id);go('lyrics');selectedLyric=null;$('#lyricTitle').value=t.name;$('#lyricArtist').value=t.artist||'';$('#lyricText').value='';$('#lyricsTrackName').textContent=`${t.name} • ${t.artist||'Artista desconhecido'}`;toast('Ainda não há letra. Cole aqui e salve uma vez.')};
async function waitForEqInfo(){if(!usingNativePlayback())return null;let last=null;for(let i=0;i<8;i++){try{let info=await mediaLibrary().getEqualizerInfo();last=info;if(info?.available!==false&&(info?.bands||[]).length)return info}catch(e){last=e}await new Promise(r=>setTimeout(r,150))}if(last?.reason)throw new Error(last.reason);throw last||new Error('Equalizador indisponível')}
async function enableEqIfNeeded(){if(!state.playerSettings.eqEnabled){state.playerSettings.eqEnabled=true;$('#eqEnabled').checked=true}if(usingNativePlayback()){let r=await mediaLibrary().setEqualizerEnabled({enabled:true});if(r?.available===false)throw new Error('Equalizador indisponível')}save()}
async function openEqualizer(){let status=$('#eqStatusText');if(songIndex<0){status.textContent='Escolha uma música primeiro';$('#eqNotice').textContent='Inicie uma música para conectar o equalizador à sessão de áudio.';renderEqBands([]);$('#equalizerDialog').showModal();return}if(!usingNativePlayback()){status.textContent='Arquivo importado';$('#eqNotice').textContent='O EQ completo funciona nas músicas da biblioteca Android.';renderEqBands([])}else try{eqInfo=await waitForEqInfo();renderEqBands(eqInfo.bands||[]);status.textContent=state.playerSettings.eqEnabled?'Equalizador ativo':'Pronto para ativar';$('#eqNotice').textContent=`${(eqInfo.bands||[]).length} bandas conectadas à mesma sessão do Player.`}catch(e){console.warn(e);status.textContent='EQ indisponível';$('#eqNotice').textContent=e?.message||'O aparelho não disponibilizou o equalizador para esta faixa.';renderEqBands([])}$('#equalizerDialog').showModal()}
function renderEqBands(bands){let el=$('#eqBands');if(!bands.length){el.innerHTML='<div class="eq-empty">Inicie uma música da biblioteca para carregar as bandas reais do aparelho.</div>';return}el.innerHTML=bands.map((b,i)=>`<label class="eq-band"><b id="eqGain${i}">${((state.playerSettings.eqBands[i]??b.level??0)>0?'+':'')+(state.playerSettings.eqBands[i]??b.level??0)} dB</b><span class="eq-vslider"><input data-band="${b.index??i}" data-i="${i}" type="range" min="-12" max="12" step="1" value="${state.playerSettings.eqBands[i]??b.level??0}"></span><small>${formatFreq(b.frequency)}</small></label>`).join('');el.querySelectorAll('input').forEach(x=>x.oninput=async()=>{let i=+x.dataset.i,v=+x.value;state.playerSettings.eqBands[i]=v;$(`#eqGain${i}`).textContent=(v>0?'+':'')+v+' dB';$$('#eqPresets button').forEach(b=>b.classList.remove('active'));try{await enableEqIfNeeded();let r=await mediaLibrary().setEqBand({band:+x.dataset.band,level:v});if(r?.applied===false)throw new Error('Banda indisponível');$('#eqStatusText').textContent='Equalizador ativo'}catch(e){console.warn(e);$('#eqStatusText').textContent='Não foi possível aplicar esta banda'}save()})}
function formatFreq(v){return v>=1000?(v/1000).toFixed(v>=10000?0:1)+'k':Math.round(v)+'Hz'}
$('#eqEnabled').onchange=async e=>{state.playerSettings.eqEnabled=e.target.checked;try{if(usingNativePlayback()){let r=await mediaLibrary().setEqualizerEnabled({enabled:e.target.checked});if(e.target.checked&&r?.available===false)throw new Error('Equalizador indisponível')}$('#eqStatusText').textContent=e.target.checked?'Equalizador ativo':'Equalizador desligado'}catch(err){console.warn(err);e.target.checked=false;state.playerSettings.eqEnabled=false;$('#eqStatusText').textContent='EQ indisponível nesta faixa'}save()};
const eqPresets={flat:[0,0,0,0,0,0,0,0,0,0],worship:[2,1,0,-1,0,1,2,2,1,0],voice:[-3,-2,0,2,3,3,2,1,0,-1],bass:[5,4,3,1,0,-1,-1,0,1,1],bright:[-1,-1,0,1,2,3,4,4,3,2]};
$$('#eqPresets button').forEach(b=>b.onclick=async()=>{let inputs=$$('#eqBands input');if(!inputs.length)return toast('Dê play na música primeiro');try{await enableEqIfNeeded()}catch(e){return toast('Equalizador indisponível nesta faixa')}let vals=eqPresets[b.dataset.preset];state.playerSettings.eqPreset=b.dataset.preset;state.playerSettings.eqBands=vals.slice(0,inputs.length);$$('#eqPresets button').forEach(x=>x.classList.toggle('active',x===b));for(let i=0;i<inputs.length;i++){let x=inputs[i],v=vals[i]??0;x.value=v;$(`#eqGain${i}`).textContent=(v>0?'+':'')+v+' dB';await mediaLibrary().setEqBand({band:+x.dataset.band,level:v}).catch(console.warn)}$('#eqStatusText').textContent='Preset aplicado';save()});
$('#bassBoost').oninput=async e=>{let v=+e.target.value;state.playerSettings.bass=v;$('#bassValue').textContent=v+'%';if(isNativePlayer())await mediaLibrary().setBassBoost({strength:v}).catch(console.warn);save()};$('#playerReverb').oninput=async e=>{let v=+e.target.value;state.playerSettings.reverb=v;$('#reverbValue').textContent=v+'%';if(isNativePlayer())await mediaLibrary().setReverb({strength:v}).catch(console.warn);save()};$('#virtualizer').oninput=async e=>{let v=+e.target.value;state.playerSettings.virtualizer=v;$('#virtualizerValue').textContent=v+'%';if(isNativePlayer())await mediaLibrary().setVirtualizer({strength:v}).catch(console.warn);save()};
async function analyzeCurrentTrack(){
  let track=currentTrack();if(!track)return toast('Escolha uma música primeiro');let button=$('#analyzeBtn'),old=button.textContent;button.disabled=true;button.textContent='ANALISANDO...';
  try{
    if(!track.url&&track.nativeUri){let r=await mediaLibrary().prepareSong({uri:track.nativeUri,id:trackKey(track),fileName:track.fileName||track.name});track.url=window.Capacitor.convertFileSrc(r.fileUri)}
    let raw=track.file?await track.file.arrayBuffer():await (await fetch(track.url)).arrayBuffer(),buffer=await ctx().decodeAudioData(raw.slice(0)),source=buffer.getChannelData(0),rate=buffer.sampleRate;
    let hop=1024,limit=Math.min(source.length,rate*90),energy=[];for(let i=0;i<limit;i+=hop){let sum=0;for(let j=i;j<Math.min(i+hop,limit);j++)sum+=Math.abs(source[j]);energy.push(sum/hop)}
    let mean=energy.reduce((a,b)=>a+b,0)/Math.max(1,energy.length),peaks=[];for(let i=1;i<energy.length-1;i++)if(energy[i]>mean*1.55&&energy[i]>energy[i-1]&&energy[i]>=energy[i+1]&&(!peaks.length||(i-peaks.at(-1))*hop/rate>.22))peaks.push(i);
    let bins=new Map();for(let i=1;i<peaks.length;i++){let bpm=60/((peaks[i]-peaks[i-1])*hop/rate);while(bpm<65)bpm*=2;while(bpm>180)bpm/=2;let rounded=Math.round(bpm);bins.set(rounded,(bins.get(rounded)||0)+1)}let bpm=[...bins].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
    let sampleRate=5512,duration=Math.min(10,buffer.duration),step=Math.max(1,Math.floor(rate/sampleRate)),samples=[];for(let i=0;i<duration*rate;i+=step)samples.push(source[i]);let chroma=Array(12).fill(0),names=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
    for(let midi=36;midi<=83;midi++){let freq=440*Math.pow(2,(midi-69)/12),w=2*Math.PI*freq/(rate/step),cos=Math.cos(w),sin=Math.sin(w),re=0,im=0;for(let i=0;i<samples.length;i++){re+=samples[i]*Math.cos(w*i);im-=samples[i]*Math.sin(w*i)}chroma[midi%12]+=Math.sqrt(re*re+im*im)}let key=names[chroma.indexOf(Math.max(...chroma))]||null;
    state.trackAnalysis[trackKey(track)]={bpm,key,analyzedAt:Date.now()};save();updateTrackAnalysisUI(track);toast(bpm&&key?`Análise aproximada: ${bpm} BPM · ${key}`:'Não foi possível concluir a análise');
  }catch(error){console.error(error);toast('Este arquivo não permitiu análise automática')}
  finally{button.disabled=false;button.textContent=old}
}
$('#analyzeBtn').onclick=analyzeCurrentTrack;
async function restoreNativeMix(trackId){if(!isNativePlayer()||!trackId||restoredEqTrackId===trackId)return;restoredEqTrackId=trackId;let p=mediaLibrary(),s=state.playerSettings;try{await p.setPlayback({pitch:s.pitch,speed:s.speed});await p.setEqualizerEnabled({enabled:s.eqEnabled});await p.setBassBoost({strength:s.bass});await p.setReverb({strength:s.reverb});await p.setVirtualizer({strength:s.virtualizer});if(s.eqEnabled&&s.eqBands.length){let info=await p.getEqualizerInfo();if(info?.available!==false)for(let i=0;i<Math.min(info.bands?.length||0,s.eqBands.length);i++)await p.setEqBand({band:info.bands[i].index,level:s.eqBands[i]})}}catch(e){console.warn(e)}}
async function initPlayer(){let s=state.playerSettings;$('#nowVolume').value=$('#songVolume').value=$('#metroMusicVolume').value=s.volume;$('#nowPitch').value=$('#pitch').value=s.pitch;$('#nowSpeed').value=s.speed;$('#bassBoost').value=s.bass;$('#playerReverb').value=s.reverb;$('#virtualizer').value=s.virtualizer;$('#bassValue').textContent=s.bass+'%';$('#reverbValue').textContent=s.reverb+'%';$('#virtualizerValue').textContent=s.virtualizer+'%';$('#nowVolumeValue').textContent=$('#volumeValue').textContent=$('#metroMusicVolumeValue').textContent=Math.round(s.volume*100)+'%';$('#nowPitchValue').textContent=$('#pitchValue').textContent=(s.pitch>0?'+':'')+s.pitch+' st';$('#nowSpeedValue').textContent=Math.round(s.speed*100)+'%';$('#shuffleSong').classList.toggle('active',s.shuffle);$('#repeatSong').classList.toggle('active',s.repeat>0);$('#repeatSong').textContent=s.repeat===1?'↻¹':'↻';$('#eqEnabled').checked=s.eqEnabled;renderPlayerView();if(isNativePlayer()){try{await mediaLibrary().addListener('playerState',applyNativeState);await mediaLibrary().addListener('playerError',data=>{console.warn(data);playerBackend='native';playerPlaying=false;updatePlay();toast(data?.message||'Não foi possível reproduzir esta música')});await restoreStateFromNative()}catch(e){console.warn(e)}}}
initPlayer();syncMiniPlayerVisibility();
let bpm=120,subBeat=0;function setBpm(v){bpm=Math.max(30,Math.min(260,+v));$('#bpmDisplay').textContent=bpm;$('#bpmRange').value=bpm;$('#drumBpmValue').textContent=bpm}function tapBpm(){let n=performance.now();taps=taps.filter(t=>n-t<2500);taps.push(n);if(taps.length>1){let ds=taps.slice(1).map((t,i)=>t-taps[i]);setBpm(Math.round(60000/(ds.reduce((a,b)=>a+b)/ds.length)))}}$('#bpmRange').oninput=e=>setBpm(e.target.value);$('#bpmMinus').onclick=()=>setBpm(bpm-1);$('#bpmPlus').onclick=()=>setBpm(bpm+1);$('#tapTempo').onclick=$('#drumTap').onclick=tapBpm;setBpm(120);function syncLoopRateButtons(){$$('#drumLoopRates button').forEach(b=>b.classList.toggle('active',+b.dataset.rate===+state.drumLoopRate))}
$$('#drumLoopRates button').forEach(b=>b.onclick=()=>{state.drumLoopRate=+b.dataset.rate;drumLoops.forEach(loop=>loop.rate=state.drumLoopRate);$$('.pad-repeat-button small').forEach(x=>x.textContent=repeatRateLabel(state.drumLoopRate));save();syncLoopRateButtons();toast(`Loop: ${repeatRateLabel(state.drumLoopRate)} tempo${state.drumLoopRate>1?'s':''}`)});syncLoopRateButtons();
function renderBeats(){let n=parseInt($('#signature').value);while(state.accents.length<n)state.accents.push(1);$('#beatLights').style.setProperty('--beats',n);$('#beatLights').innerHTML=Array.from({length:n},(_,i)=>`<button class="beat-channel" data-i="${i}" data-level="${state.accents[i]??1}"><span>${i+1}</span><div class="beat-bars"><i></i><i></i><i></i><i></i></div></button>`).join('');$$('.beat-channel').forEach(x=>x.onclick=()=>{let i=+x.dataset.i;state.accents[i]=(state.accents[i]+1)%4;x.dataset.level=state.accents[i];save()})}$('#signature').onchange=renderBeats;renderBeats();
function click(at,index,isSubdivision=false){const c=ctx(),o=c.createOscillator(),g=c.createGain(),kind=$('#clickSound').value,level=isSubdivision?1:(state.accents[index]??1);let freqs={digital:1100,wood:520,soft:700,bright:1600},amps=[0,.42,.68,1];o.frequency.value=freqs[kind]*(isSubdivision?.72:(level===3?1.35:level===2?1.15:1));let amount=(isSubdivision?.38:amps[level])*+$('#metroVolume').value*1.35;g.gain.setValueAtTime(Math.max(.001,amount),at);g.gain.exponentialRampToValueAtTime(.001,at+(isSubdivision?.035:.055));o.connect(g).connect(c.destination);o.start(at);o.stop(at+.065);if(!isSubdivision){let lights=$$('.beat-channel');setTimeout(()=>{lights.forEach(x=>x.classList.remove('hit'));lights[index]?.classList.add('hit')},Math.max(0,(at-c.currentTime)*1000))}}
function scheduler(){while(nextNoteTime<ctx().currentTime+.1){let count=parseInt($('#signature').value),division=+$('#subdivision').value||1,isSubdivision=subBeat>0;click(nextNoteTime,beat,isSubdivision);nextNoteTime+=60/bpm/division;subBeat=(subBeat+1)%division;if(subBeat===0)beat=(beat+1)%count}metroTimer=setTimeout(scheduler,25)}
$('#metroVolume').value=state.metroSettings.clickVolume;$('#metroClickVolumeValue').textContent=Math.round(state.metroSettings.clickVolume*100)+'%';$('#metroVolume').oninput=e=>{state.metroSettings.clickVolume=+e.target.value;$('#metroClickVolumeValue').textContent=Math.round(+e.target.value*100)+'%';save()};syncMetroTrackUi();$('#subdivision').onchange=()=>{subBeat=0};$('#metroStart').onclick=()=>{if(metroTimer){clearTimeout(metroTimer);metroTimer=null;$('#metroStart').textContent='▶ INICIAR METRÔNOMO';$$('.beat-channel').forEach(x=>x.classList.remove('hit'))}else{beat=0;subBeat=0;nextNoteTime=ctx().currentTime+.05;scheduler();$('#metroStart').textContent='■ PARAR METRÔNOMO'}};
let padDbPromise,editorIndex=-1,pendingBuffer=null,pendingFileName='',pendingNativeFile=null,previewSource=null,drumFx=null;const padRawCache=new Map(),padDecodedCache=new Map(),drumLoops=new Map();
function openPadDb(){if(padDbPromise)return padDbPromise;padDbPromise=new Promise((resolve,reject)=>{let request=indexedDB.open('nexo-pad-audio',1);request.onupgradeneeded=()=>request.result.createObjectStore('audio');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return padDbPromise}
async function putPadAudio(key,buffer){let db=await openPadDb();return new Promise((resolve,reject)=>{let tx=db.transaction('audio','readwrite');tx.objectStore('audio').put(buffer,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
async function getPadAudio(key){if(!key)return null;let db=await openPadDb();return new Promise((resolve,reject)=>{let request=db.transaction('audio').objectStore('audio').get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error)})}
async function removePadAudio(key){if(!key)return;padRawCache.delete(key);padDecodedCache.delete(key);let db=await openPadDb();return new Promise((resolve,reject)=>{let tx=db.transaction('audio','readwrite');tx.objectStore('audio').delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
function arrayToBase64(buf){let binary='',bytes=new Uint8Array(buf),chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(binary)}function base64ToArray(s){let b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer}
const nativePadPicker=()=>!!(window.Capacitor?.isNativePlatform?.()&&mediaLibrary()?.pickAudioFiles);
function nativePadCacheKey(uri){return 'native:'+String(uri||'')}
async function nativePadRaw(uri){if(!uri)return null;let src=window.Capacitor?.convertFileSrc?window.Capacitor.convertFileSrc(uri):uri,res=await fetch(src);if(!res.ok)throw new Error('Arquivo local indisponível');return res.arrayBuffer()}
async function discardNativePadFile(fileOrUri){let uri=typeof fileOrUri==='string'?fileOrUri:fileOrUri?.fileUri;if(!uri||!window.Capacitor?.isNativePlatform?.()||!mediaLibrary()?.deletePadFile)return;try{await mediaLibrary().deletePadFile({fileUri:uri})}catch(error){console.warn('Não foi possível limpar o arquivo temporário do pad',error)}}
async function removePadAsset(p){if(!p)return;if(p.audioKey)await removePadAudio(p.audioKey);if(p.nativeFileUri)await discardNativePadFile(p.nativeFileUri);if(p.nativeFileUri){padRawCache.delete(nativePadCacheKey(p.nativeFileUri));padDecodedCache.delete(nativePadCacheKey(p.nativeFileUri))}}
async function rawForPad(p){if(p.audioKey)return getPadAudio(p.audioKey);if(p.nativeFileUri)return nativePadRaw(p.nativeFileUri);if(p.buffer)return base64ToArray(p.buffer);return null}
function rememberDecoded(cache,key,decoded,max=4){if(cache.has(key))cache.delete(key);cache.set(key,decoded);while(cache.size>max)cache.delete(cache.keys().next().value);return decoded}async function decodedForPad(i,p){let key=p.nativeFileUri?nativePadCacheKey(p.nativeFileUri):(p.audioKey||`antigo-${i}-${p.fileName||''}`);if(padDecodedCache.has(key)){let v=padDecodedCache.get(key);padDecodedCache.delete(key);padDecodedCache.set(key,v);return v}let raw=await rawForPad(p);if(!raw)return null;let decoded=await ctx().decodeAudioData(raw.slice(0));raw=null;return rememberDecoded(padDecodedCache,key,decoded,4)}
function ensureDrumFx(){let c=ctx();if(drumFx)return drumFx;let convolver=c.createConvolver(),length=Math.floor(c.sampleRate*1.5),impulse=c.createBuffer(2,length,c.sampleRate);for(let ch=0;ch<2;ch++){let data=impulse.getChannelData(ch);for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,3)}convolver.buffer=impulse;let wet=c.createGain();wet.gain.value=+$('#drumReverb').value*.55;convolver.connect(wet).connect(c.destination);drumFx={convolver,wet};return drumFx}
function connectDrum(node){let fx=ensureDrumFx();node.connect(ctx().destination);node.connect(fx.convolver)}$('#drumReverb').oninput=e=>{if(drumFx)drumFx.wet.gain.setTargetAtTime(+e.target.value*.55,ctx().currentTime,.03)};
function repeatRateLabel(value){value=+(value||1);return value===.25?'¼':value===.5?'½':value===1?'1':value===2?'2':'4'}
function currentDrumBank(){return (state.drumBanks||[]).find(b=>b.id===state.activeDrumBankId)||state.drumBanks?.[0]||null}
function cloneDrumPads(pads){return JSON.parse(JSON.stringify(pads||[]))}
function renderDrumBankTabs(){let el=$('#drumBankTabs');if(!el)return;el.innerHTML=(state.drumBanks||[]).map(b=>`<button type="button" class="${b.id===state.activeDrumBankId?'active':''}" data-drum-bank="${clean(b.id)}"><b>${clean(b.name)}</b><small>${(b.pads||[]).length} pads${b.driveManaged?' · DRIVE':''}</small></button>`).join('');el.querySelectorAll('[data-drum-bank]').forEach(btn=>btn.onclick=()=>switchDrumBank(btn.dataset.drumBank))}
function switchDrumBank(id){if(id===state.activeDrumBankId)return;let current=currentDrumBank();if(current)current.pads=cloneDrumPads(state.pads);let next=(state.drumBanks||[]).find(b=>b.id===id);if(!next)return;[...drumLoops.keys()].forEach(stopDrumLoop);state.activeDrumBankId=id;state.pads=cloneDrumPads(next.pads);editingPads=false;$('#editPads').textContent='EDITAR';save();renderDrums();toast(`Banco ${next.name}`)}
function renderDrums(){const g=$('#drumGrid'),bank=currentDrumBank();$('#drumBankCount').textContent=`${bank?.name||'BANCO'} · ${state.pads.length} ${state.pads.length===1?'PAD':'PADS'}`;renderDrumBankTabs();g.innerHTML=state.pads.map((p,i)=>{let looping=drumLoops.has(i),cloud=!!(p.driveRelativePath&&!p.nativeFileUri&&!p.audioKey&&!p.buffer);return `<div class="drum-pad ${looping?'looping':''} ${cloud?'cloud':''}" style="--pad:${p.color}" data-i="${i}" role="button" tabindex="0" aria-label="Tocar ${clean(p.name)}">${editingPads?`<button class="pad-edit-button" type="button" data-edit="${i}" aria-label="Editar ${clean(p.name)}">⚙</button>`:''}<button class="pad-repeat-button ${looping?'active':''}" type="button" data-repeat="${i}" aria-pressed="${looping}" title="Repetir no BPM atual"><span>↻</span><small>${repeatRateLabel(state.drumLoopRate)}</small></button><b>${clean(p.name)}</b><small class="pad-file-name">${cloud?'☁ NA NUVEM':clean(p.fileName||'SOM DEMO')}</small><span class="level-tag">${Math.round((p.volume??1)*100)}%</span></div>`}).join('');
g.querySelectorAll('.drum-pad').forEach(el=>{el.onclick=e=>{if(e.target.closest('button'))return;editingPads?editPad(+el.dataset.i):hitPad(+el.dataset.i,el)};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();editingPads?editPad(+el.dataset.i):hitPad(+el.dataset.i,el)}}});
g.querySelectorAll('.pad-repeat-button').forEach(btn=>btn.onclick=e=>{e.stopPropagation();if(editingPads)return toast('Conclua a edição para usar a repetição');toggleDrumLoop(+btn.dataset.repeat,g.querySelector(`.drum-pad[data-i="${btn.dataset.repeat}"]`))});
g.querySelectorAll('.pad-edit-button').forEach(btn=>btn.onclick=e=>{e.stopPropagation();editPad(+btn.dataset.edit)})}
function resetPendingPadFile(){pendingBuffer=null;pendingFileName='';pendingNativeFile=null;$('#padFile').value=''}
function editPad(i){editorIndex=i;let p=state.pads[i];if(!p)return;resetPendingPadFile();$('#editorPadNumber').textContent='PAD '+String(i+1).padStart(2,'0');$('#padName').value=p.name;$('#padColor').value=p.color;$('#padVolume').value=p.volume??1;$('#padVolumeValue').textContent=Math.round((p.volume??1)*100)+'%';$('#padFileName').textContent=p.fileName||'Nenhum arquivo';$('#padEditor').showModal()}
$('#padVolume').oninput=e=>$('#padVolumeValue').textContent=Math.round(e.target.value*100)+'%';
async function receiveNativePadFile(file){if(!file?.fileUri)return false;pendingNativeFile=file;pendingBuffer=null;pendingFileName=file.name||'Áudio';$('#padFileName').textContent=pendingFileName;try{toast('Arquivo escolhido. Toque em TESTAR ou SALVAR');return true}catch(error){console.error(error);await discardNativePadFile(file);resetPendingPadFile();$('#padFileName').textContent='Nenhum arquivo';toast('Não foi possível abrir este arquivo');return false}}
$('#choosePadFile').onclick=async()=>{if(!nativePadPicker()){return $('#padFile').click()}try{let result=await mediaLibrary().pickAudioFiles({multiple:false}),file=result?.files?.[0];if(file)await receiveNativePadFile(file)}catch(error){console.error(error);if(!String(error?.message||error).toLowerCase().includes('cancel'))toast('Não foi possível abrir a pasta de áudio')}};
$('#padFile').onchange=async e=>{let f=e.target.files[0];if(!f)return;try{if(pendingNativeFile)await discardNativePadFile(pendingNativeFile);pendingNativeFile=null;pendingBuffer=await f.arrayBuffer();pendingFileName=f.name;$('#padFileName').textContent=f.name;toast('Arquivo pronto. Toque em TESTAR ou SALVAR')}catch(error){console.error(error);toast('Não foi possível abrir este arquivo')}};
$('#previewPad').onclick=async()=>{try{let p=state.pads[editorIndex],raw=pendingBuffer||(pendingNativeFile?await nativePadRaw(pendingNativeFile.fileUri):await rawForPad(p));if(!raw)return toast('Escolha um arquivo de áudio primeiro');let c=ctx(),b=await c.decodeAudioData(raw.slice(0)),src=c.createBufferSource(),g=c.createGain();if(previewSource)try{previewSource.stop()}catch{}src.buffer=b;g.gain.value=+$('#padVolume').value*+$('#drumVolume').value;connectDrum(g);src.connect(g);src.start();previewSource=src;$('.mini-meter').classList.add('playing');src.onended=()=>$('.mini-meter').classList.remove('playing')}catch(error){console.error(error);toast('Formato de áudio não suportado neste aparelho')}};
$('#savePad').onclick=async()=>{let p=state.pads[editorIndex];if(!p)return;try{p.name=$('#padName').value.trim()||p.name;p.color=$('#padColor').value;p.volume=+$('#padVolume').value;delete p.repeat;if(pendingNativeFile){if(p.audioKey)await removePadAudio(p.audioKey);if(p.nativeFileUri&&p.nativeFileUri!==pendingNativeFile.fileUri)await discardNativePadFile(p.nativeFileUri);p.nativeFileUri=pendingNativeFile.fileUri;delete p.audioKey;delete p.buffer;p.fileName=pendingFileName;let key=nativePadCacheKey(p.nativeFileUri);padRawCache.delete(key);padDecodedCache.delete(key);pendingBuffer=null;pendingNativeFile=null}else if(pendingBuffer){if(p.nativeFileUri){await discardNativePadFile(p.nativeFileUri);padRawCache.delete(nativePadCacheKey(p.nativeFileUri));padDecodedCache.delete(nativePadCacheKey(p.nativeFileUri));delete p.nativeFileUri}p.audioKey=p.audioKey||`pad-${Date.now()}-${editorIndex}`;await putPadAudio(p.audioKey,pendingBuffer);padRawCache.delete(p.audioKey);padDecodedCache.delete(p.audioKey);delete p.buffer;p.fileName=pendingFileName}stopDrumLoop(editorIndex);save();resetPendingPadFile();renderDrums();$('#padEditor').close();toast('Pad configurado e salvo')}catch(error){console.error(error);toast('Não foi possível salvar este áudio')}};
$('#clearPad').onclick=async()=>{let p=state.pads[editorIndex];if(!p)return;if(pendingNativeFile)await discardNativePadFile(pendingNativeFile);await removePadAsset(p);delete p.audioKey;delete p.nativeFileUri;delete p.buffer;delete p.fileName;resetPendingPadFile();$('#padFileName').textContent='Nenhum arquivo';stopDrumLoop(editorIndex);save();renderDrums()};
$('#deletePad').onclick=async()=>{if(state.pads.length<=1)return toast('O banco precisa ter pelo menos um pad');if(!confirm('Excluir este pad do banco?'))return;let p=state.pads[editorIndex];if(pendingNativeFile)await discardNativePadFile(pendingNativeFile);await removePadAsset(p);[...drumLoops.keys()].forEach(stopDrumLoop);state.pads.splice(editorIndex,1);resetPendingPadFile();save();renderDrums();$('#padEditor').close();toast('Pad excluído')};
async function closePadEditor(){if(pendingNativeFile)await discardNativePadFile(pendingNativeFile);resetPendingPadFile();$('#padEditor').close()}
$('.close-editor').onclick=closePadEditor;
$('#padEditor').addEventListener('cancel',e=>{e.preventDefault();closePadEditor()});
async function playPadSound(i,el){let p=state.pads[i];if(!p)return;if(p.driveRelativePath&&!p.nativeFileUri&&!p.audioKey&&!p.buffer){toast('Este banco está no Drive. Baixe para tocar sem atraso.');openDriveFor('Drums');return}ctx();if(el){el.classList.add('hit');setTimeout(()=>el.classList.remove('hit'),120)}try{let buffer=await decodedForPad(i,p);if(buffer){let src=audioCtx.createBufferSource(),gain=audioCtx.createGain();src.buffer=buffer;gain.gain.value=+$('#drumVolume').value*(p.volume??1);connectDrum(gain);src.connect(gain);src.start()}else{let o=audioCtx.createOscillator(),g=audioCtx.createGain();o.frequency.setValueAtTime([80,120,180,240,320,440][i%6],audioCtx.currentTime);o.frequency.exponentialRampToValueAtTime(45,audioCtx.currentTime+.15);g.gain.setValueAtTime(.35*+$('#drumVolume').value*(p.volume??1),audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.22);connectDrum(g);o.connect(g);o.start();o.stop(audioCtx.currentTime+.23)}}catch(error){console.error(error);toast('Este arquivo não pôde ser tocado')}}
function stopDrumLoop(i){let loop=drumLoops.get(i);if(loop)clearTimeout(loop.timer);drumLoops.delete(i);let pad=$(`.drum-pad[data-i="${i}"]`),btn=$(`.pad-repeat-button[data-repeat="${i}"]`);pad?.classList.remove('looping');btn?.classList.remove('active');btn?.setAttribute('aria-pressed','false')}
function toggleDrumLoop(i,el){if(drumLoops.has(i)){stopDrumLoop(i);return}let loop={timer:null,rate:+state.drumLoopRate||1};drumLoops.set(i,loop);el?.classList.add('looping');let btn=$(`.pad-repeat-button[data-repeat="${i}"]`);btn?.classList.add('active');btn?.setAttribute('aria-pressed','true');let tick=()=>{if(!drumLoops.has(i))return;playPadSound(i,el);let beats=Math.max(.25,loop.rate||1);loop.timer=setTimeout(tick,Math.max(40,60000/bpm*beats))};tick()}
async function hitPad(i,el){await playPadSound(i,el)}
$('#addDrumPad').onclick=()=>{let i=state.pads.length;state.pads.push({name:`PAD ${i+1}`,color:padColors[i%padColors.length],volume:1});editingPads=true;$('#editPads').textContent='CONCLUIR';save();renderDrums();editPad(i)};
async function addNativePadFiles(files){let added=0;for(let file of files||[]){if(!file?.fileUri)continue;let i=state.pads.length;state.pads.push({name:(file.name||`PAD ${i+1}`).replace(/\.[^.]+$/,''),fileName:file.name||'Áudio',nativeFileUri:file.fileUri,color:padColors[i%padColors.length],volume:1});added++}if(added){save();renderDrums()}return added}
$('#importDrumSounds').onclick=async()=>{if(!nativePadPicker())return $('#drumBankFiles').click();try{let result=await mediaLibrary().pickAudioFiles({multiple:true}),files=result?.files||[];if(!files.length)return;toast(`Importando ${files.length} arquivo(s)...`);let added=await addNativePadFiles(files);toast(`${added} som(ns) adicionado(s) ao banco`)}catch(error){console.error(error);if(!String(error?.message||error).toLowerCase().includes('cancel'))toast('Não foi possível importar os sons')}};
$('#drumBankFiles').onchange=async e=>{let files=[...e.target.files];if(!files.length)return;let added=0;toast(`Importando ${files.length} arquivo(s)...`);for(let file of files){try{let raw=await file.arrayBuffer(),i=state.pads.length,key=`pad-${Date.now()}-${i}-${added}`;await putPadAudio(key,raw);state.pads.push({name:file.name.replace(/\.[^.]+$/,''),fileName:file.name,audioKey:key,color:padColors[i%padColors.length],volume:1});raw=null;added++}catch(error){console.error(error)}}e.target.value='';save();renderDrums();toast(`${added} som(ns) adicionado(s) ao banco`)};
$('#editPads').onclick=()=>{editingPads=!editingPads;if(editingPads)[...drumLoops.keys()].forEach(stopDrumLoop);$('#editPads').textContent=editingPads?'CONCLUIR':'EDITAR';renderDrums()};renderDrums();
let ambientVoices=[],ambientPlayToken=0,ambientLoadingNote=null,editingAmbientBankId=null,ambientBankDraft=null,ambientAssignContext=null;
const ambientAssetIndex=new Map();
function rebuildAmbientAssetIndex(){ambientAssetIndex.clear();for(let a of state.ambientLibrary||[])if(a?.id)ambientAssetIndex.set(a.id,a)}
rebuildAmbientAssetIndex();
function ambientAsset(id){return id?ambientAssetIndex.get(id)||null:null}
function currentAmbientBank(){return state.ambientBanks.find(x=>x.id===state.activeAmbientBankId)||state.ambientBanks[0]||null}
function configuredAmbientCount(bank=currentAmbientBank()){return bank?tonalNotes.filter(n=>bank.slots?.[n.key]).length:0}
const nativeAmbientPlayer=()=>!!(window.Capacitor?.isNativePlatform?.()&&mediaLibrary()?.playAmbientPad);
function cutoffHz(value=state.ambientSettings.cutoff){let t=Math.max(0,Math.min(100,+value))/100;return 220*Math.pow(20000/220,t)}
function cutoffLabel(value){let f=cutoffHz(value);return f>=1000?`${(f/1000).toFixed(f>=10000?0:1)} kHz`:`${Math.round(f)} Hz`}
function disposeAmbientWebVoice(voice,fadeOverride=null){
  if(!voice||voice.native)return;let c=ctx(),fade=fadeOverride??(+state.ambientSettings.fade||0),finish=()=>{try{voice.audio?.pause()}catch{}try{voice.source?.disconnect()}catch{}try{voice.filter?.disconnect()}catch{}try{voice.gain?.disconnect()}catch{}if(voice.objectUrl)try{URL.revokeObjectURL(voice.objectUrl)}catch{}};
  try{voice.gain.gain.cancelScheduledValues(c.currentTime);voice.gain.gain.setValueAtTime(Math.max(.0001,voice.gain.gain.value),c.currentTime);voice.gain.gain.linearRampToValueAtTime(.0001,c.currentTime+Math.max(.02,fade));setTimeout(finish,Math.max(40,fade*1000+80))}catch{finish()}
}
async function stopAmbientNow(){
  ambientPlayToken++;ambientLoadingNote=null;let old=[...ambientVoices];ambientVoices=[];renderAmbientLive();
  await Promise.all(old.map(async voice=>{if(voice?.native&&nativeAmbientPlayer()){try{await mediaLibrary().stopAmbientPad({slot:voice.slot,fadeMs:800})}catch(error){console.warn(error)}}else if(voice)disposeAmbientWebVoice(voice,.8)}))
}
async function prepareAmbientWebVoice(asset){
  let raw=await rawForPad(asset);if(!raw)return null;let mime=/\.wav$/i.test(asset.fileName||'')?'audio/wav':/\.(m4a|aac)$/i.test(asset.fileName||'')?'audio/mp4':'audio/mpeg';let objectUrl=URL.createObjectURL(new Blob([raw],{type:mime}));raw=null;
  let audio=new Audio(objectUrl);audio.preload='metadata';audio.loop=true;let c=ctx(),source=c.createMediaElementSource(audio),filter=c.createBiquadFilter(),gain=c.createGain();filter.type='lowpass';filter.frequency.setValueAtTime(cutoffHz(),c.currentTime);filter.Q.value=.15;gain.gain.setValueAtTime(.0001,c.currentTime);source.connect(filter).connect(gain).connect(c.destination);return {native:false,audio,source,filter,gain,objectUrl}
}
async function playAmbientNote(noteKey){
  if(ambientLoadingNote)return;let bank=currentAmbientBank();if(!bank)return;
  let already=ambientVoices.find(v=>v.bankId===bank.id&&v.noteKey===noteKey);if(already){ambientVoices=ambientVoices.filter(v=>v!==already);if(already.native&&nativeAmbientPlayer())await mediaLibrary().stopAmbientPad({slot:already.slot,fadeMs:800}).catch(console.warn);else disposeAmbientWebVoice(already,.8);renderAmbientLive();return}
  let asset=ambientAsset(bank.slots?.[noteKey]);if(!asset){openAmbientLibraryForNote(noteKey,'direct');return}
  if(asset.driveRelativePath&&!asset.nativeFileUri&&!asset.audioKey&&!asset.buffer){toast(`O banco ${bank.name} está no Drive. Baixe para tocar em tempo real.`);openDriveFor('Pads');return}
  let token=++ambientPlayToken,noteLabel=tonalNotes.find(n=>n.key===noteKey)?.label||noteKey;ambientLoadingNote=noteKey;$('#ambientReadyStatus').textContent=`CARREGANDO ${noteLabel}...`;renderAmbientGrid();
  try{
    let fade=.8,volume=Math.max(0,Math.min(1,+state.ambientSettings.volume||0)),previous=ambientVoices.length>=2?ambientVoices.shift():null,slot=previous?.slot??([0,1].find(n=>!ambientVoices.some(v=>v.slot===n))??0);
    if(asset.nativeFileUri&&nativeAmbientPlayer()){
      // Native MediaPlayer streams the pad from disk instead of decoding the whole file into WebView RAM.
      if(previous){if(previous.native)await mediaLibrary().stopAmbientPad({slot:previous.slot,fadeMs:Math.round(fade*1000)}).catch(console.warn);else disposeAmbientWebVoice(previous,fade)}
      await mediaLibrary().playAmbientPad({slot,fileUri:asset.nativeFileUri,volume,cutoff:100,fadeMs:Math.round(fade*1000)});if(token!==ambientPlayToken)return;
      ambientVoices.push({native:true,slot,bankId:bank.id,noteKey,assetId:asset.id,startedAt:Date.now()});ambientLoadingNote=null;renderAmbientLive();return
    }
    let voice=await prepareAmbientWebVoice(asset);if(token!==ambientPlayToken){if(voice)disposeAmbientWebVoice(voice,0);return}if(!voice)throw new Error('Arquivo indisponível');
    voice.slot=slot;voice.bankId=bank.id;voice.noteKey=noteKey;voice.assetId=asset.id;voice.startedAt=Date.now();await voice.audio.play();if(token!==ambientPlayToken){disposeAmbientWebVoice(voice,0);return}if(previous){if(previous.native&&nativeAmbientPlayer())try{await mediaLibrary().stopAmbientPad({slot:previous.slot,fadeMs:Math.round(fade*1000)})}catch{}else disposeAmbientWebVoice(previous,fade)}ambientVoices.push(voice);ambientLoadingNote=null;voice.gain.gain.linearRampToValueAtTime(Math.max(.0001,volume),ctx().currentTime+fade);renderAmbientLive();
  }catch(error){console.error(error);if(token===ambientPlayToken){ambientLoadingNote=null;$('#ambientReadyStatus').textContent='ERRO NO PAD';toast('Não foi possível tocar este pad');renderAmbientGrid()}}
}
function renderAmbientBankTabs(){
  let el=$('#ambientBankTabs');el.innerHTML=state.ambientBanks.map(b=>`<button type="button" class="${b.id===state.activeAmbientBankId?'active':''}" data-bank-id="${clean(b.id)}"><b>${clean(b.name)}</b><small>${configuredAmbientCount(b)}/12</small></button>`).join('');
  el.querySelectorAll('[data-bank-id]').forEach(btn=>btn.onclick=()=>{let id=btn.dataset.bankId;if(id===state.activeAmbientBankId)return;stopAmbientNow();state.activeAmbientBankId=id;save();renderAmbientLive()})
}
function renderAmbientGrid(){
  let bank=currentAmbientBank(),el=$('#noteGrid');if(!bank){el.innerHTML='';return}
  el.innerHTML=tonalNotes.map(n=>{let asset=ambientAsset(bank.slots?.[n.key]),offline=!!(asset&&(asset.nativeFileUri||asset.audioKey||asset.buffer)),cloud=!!(asset?.driveRelativePath&&!offline),layer=ambientVoices.findIndex(v=>v.bankId===bank.id&&v.noteKey===n.key),active=layer>=0,loading=ambientLoadingNote===n.key,busy=!!ambientLoadingNote;return `<article class="tonal-note ${active?'active':''} ${loading?'loading':''} ${cloud?'cloud':asset?'ready':'empty'}"><button class="tonal-note-play" type="button" data-tonal-play="${n.key}" ${busy?'disabled':''}><b>${n.label}</b><small>${loading?'CARREGANDO':cloud?'☁ NA NUVEM':asset?(active?`CAMADA ${layer+1}`:'PRONTO'):'ADICIONAR PAD'}</small><i></i></button><button class="tonal-note-config" type="button" data-tonal-config="${n.key}" aria-label="Escolher arquivo para ${n.label}" ${busy?'disabled':''}>⚙</button></article>`}).join('');
  el.querySelectorAll('[data-tonal-play]').forEach(b=>b.onclick=()=>playAmbientNote(b.dataset.tonalPlay));
  el.querySelectorAll('[data-tonal-config]').forEach(b=>b.onclick=e=>{e.stopPropagation();openAmbientLibraryForNote(b.dataset.tonalConfig,'direct')})
}
function renderAmbientLive(){
  let bank=currentAmbientBank();if(!bank)return;$('#ambientBankName').textContent=bank.name;$('#ambientBankProgress').textContent=`${configuredAmbientCount(bank)}/12 notas configuradas`;$('#ambientLibraryCount').textContent=state.ambientLibrary.length;renderAmbientBankTabs();renderAmbientGrid();
  let active=ambientVoices.filter(v=>v.bankId===bank.id),labels=active.map(v=>{let note=tonalNotes.find(n=>n.key===v.noteKey),asset=ambientAsset(v.assetId);return `<button type="button" data-stop-layer="${v.slot}"><b>${clean(note?.label||'')}</b><small>${clean(asset?.name||asset?.fileName||'Pad')} · tocar para remover</small></button>`}).join('');
  $('#activeNotes').innerHTML=active.length?`<span>≋</span><div><small>CAMADAS ATIVAS · ${clean(bank.name)}</small><section>${labels}</section></div>`:`<span>≋</span><div><small>CAMADAS ATIVAS</small><b>Nenhum pad tocando</b></div>`;
  $('#activeNotes').querySelectorAll('[data-stop-layer]').forEach(btn=>btn.onclick=()=>{let voice=ambientVoices.find(v=>String(v.slot)===btn.dataset.stopLayer);if(voice)playAmbientNote(voice.noteKey)});
  $('#ambientReadyStatus').textContent=active.length?`${active.length}/2 ATIVAS`:`${configuredAmbientCount(bank)===12?'BANCO PRONTO':'CONFIGURE O BANCO'}`
}
function renderAmbientControls(){
  $('#ambientVolume').value=state.ambientSettings.volume;$('#ambientValue').textContent=Math.round(state.ambientSettings.volume*100)+'%'
}
function cloneBank(bank){return {id:bank.id,name:bank.name,slots:{...(bank.slots||{})}}}
function openAmbientBankEditor(bankId=null,makeNew=false){
  let source=bankId?state.ambientBanks.find(b=>b.id===bankId):currentAmbientBank();editingAmbientBankId=makeNew?null:source?.id;ambientBankDraft=makeNew?{id:`bank-${Date.now()}`,name:`BANCO ${state.ambientBanks.length+1}`,slots:{}}:cloneBank(source);$('#ambientBankEditorTitle').textContent=makeNew?'Novo banco':'Configurar banco';$('#ambientBankNameInput').value=ambientBankDraft.name;$('#deleteAmbientBank').hidden=makeNew;$('#duplicateAmbientBank').hidden=makeNew;renderAmbientAssignments();$('#ambientBankEditor').showModal()
}
function renderAmbientAssignments(){
  let el=$('#ambientBankAssignments');el.innerHTML=tonalNotes.map(n=>{let asset=ambientAsset(ambientBankDraft?.slots?.[n.key]);return `<div class="ambient-assign-row"><span class="ambient-assign-note">${n.label}</span><div><b>${asset?clean(asset.name||asset.fileName):'Nenhum pad'}</b><small>${asset?clean(asset.fileName||'Arquivo local'):'Toque em escolher para vincular um arquivo'}</small></div><button type="button" data-choose-note="${n.key}">ESCOLHER</button>${asset?`<button type="button" class="clear" data-clear-note="${n.key}">×</button>`:''}</div>`}).join('');
  el.querySelectorAll('[data-choose-note]').forEach(b=>b.onclick=()=>openAmbientLibraryForNote(b.dataset.chooseNote,'draft'));
  el.querySelectorAll('[data-clear-note]').forEach(b=>b.onclick=()=>{delete ambientBankDraft.slots[b.dataset.clearNote];renderAmbientAssignments()})
}
function openAmbientLibraryForNote(noteKey,mode='direct'){
  let note=tonalNotes.find(n=>n.key===noteKey);ambientAssignContext={noteKey,mode,bankId:state.activeAmbientBankId};$('#ambientLibraryTarget').textContent=`Nota ${note?.label||noteKey} · ${mode==='draft'?(ambientBankDraft?.name||'Banco'):(currentAmbientBank()?.name||'Banco')}`;$('#ambientLibrarySearch').value='';renderAmbientLibrary();$('#ambientLibraryDialog').showModal()
}
function renderAmbientLibrary(filter=''){
  let q=String(filter).trim().toLowerCase(),rows=state.ambientLibrary.filter(a=>`${a.name||''} ${a.fileName||''}`.toLowerCase().includes(q)),el=$('#ambientLibraryList');
  el.innerHTML=rows.length?rows.map(a=>`<button type="button" class="ambient-library-row" data-ambient-asset="${clean(a.id)}"><span>≋</span><div><b>${clean(a.name||a.fileName||'Pad')}</b><small>${clean(a.fileName||'Arquivo local')}</small></div><em>USAR</em></button>`).join(''):`<div class="ambient-library-empty"><b>Nenhum pad encontrado</b><span>Importe um arquivo do celular para começar.</span></div>`;
  el.querySelectorAll('[data-ambient-asset]').forEach(b=>b.onclick=()=>assignAmbientAsset(b.dataset.ambientAsset))
}
function assignAmbientAsset(assetId){
  let ctxAssign=ambientAssignContext;if(!ctxAssign)return;let asset=ambientAsset(assetId);if(!asset)return;
  if(ctxAssign.mode==='draft'&&ambientBankDraft){ambientBankDraft.slots[ctxAssign.noteKey]=assetId;renderAmbientAssignments()}
  else{let bank=state.ambientBanks.find(b=>b.id===ctxAssign.bankId)||currentAmbientBank();if(bank){bank.slots??={};bank.slots[ctxAssign.noteKey]=assetId;save();renderAmbientLive()}}
  $('#ambientLibraryDialog').close();ambientAssignContext=null;toast('Pad vinculado à nota')
}
function noteFromFilename(name){
  let s=String(name||'').replace(/\.[^.]+$/,'').toUpperCase().replace(/♯/g,'#').replace(/♭/g,'B');
  let patterns=[['Cs',/(^|[^A-G])(?:C#|DB)(?=[^A-Z]|$)/],['Eb',/(^|[^A-G])(?:D#|EB)(?=[^A-Z]|$)/],['Fs',/(^|[^A-G])(?:F#|GB)(?=[^A-Z]|$)/],['Ab',/(^|[^A-G])(?:G#|AB)(?=[^A-Z]|$)/],['Bb',/(^|[^A-G])(?:A#|BB)(?=[^A-Z]|$)/],['C',/(^|[^A-G])C(?=[^A-Z#]|$)/],['D',/(^|[^A-G])D(?=[^A-Z#]|$)/],['E',/(^|[^A-G])E(?=[^A-Z#]|$)/],['F',/(^|[^A-G])F(?=[^A-Z#]|$)/],['G',/(^|[^A-G])G(?=[^A-Z#]|$)/],['A',/(^|[^A-G])A(?=[^A-Z#]|$)/],['B',/(^|[^A-G])B(?=[^A-Z#]|$)/]];
  for(let [key,re] of patterns)if(re.test(s))return key;return null
}
function autoMapAssetsToDraft(assetIds=null){
  if(!ambientBankDraft)return 0;let assets=(assetIds?assetIds.map(ambientAsset):state.ambientLibrary).filter(Boolean),used=new Set(Object.values(ambientBankDraft.slots||{})),count=0,remaining=[];
  for(let a of assets){if(used.has(a.id))continue;let key=noteFromFilename(a.fileName||a.name);if(key&&!ambientBankDraft.slots[key]){ambientBankDraft.slots[key]=a.id;used.add(a.id);count++}else remaining.push(a)}
  for(let n of tonalNotes){if(ambientBankDraft.slots[n.key])continue;let a=remaining.shift();if(!a)break;ambientBankDraft.slots[n.key]=a.id;count++}
  renderAmbientAssignments();return count
}
async function addAmbientNativeFiles(files){
  let added=[];for(let file of files||[]){if(!file?.fileUri)continue;let asset={id:`ambient-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:(file.name||'Pad').replace(/\.[^.]+$/,''),fileName:file.name||'Áudio',nativeFileUri:file.fileUri};state.ambientLibrary.push(asset);added.push(asset)}if(added.length){rebuildAmbientAssetIndex();save();renderAmbientLive()}return added
}
async function addAmbientWebFiles(files){
  let added=[];for(let file of files||[]){try{let raw=await file.arrayBuffer(),key=`ambient-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,asset={id:key,name:file.name.replace(/\.[^.]+$/,''),fileName:file.name,audioKey:key};await putPadAudio(key,raw);raw=null;state.ambientLibrary.push(asset);added.push(asset)}catch(error){console.error(error)}}if(added.length){rebuildAmbientAssetIndex();save();renderAmbientLive()}return added
}
async function importAmbientFilesForBank(){
  try{let added=[];if(nativePadPicker()){let result=await mediaLibrary().pickAudioFiles({multiple:true});added=await addAmbientNativeFiles(result?.files||[])}else{return $('#ambientPadFiles').click()}if(!added.length)return;let mapped=autoMapAssetsToDraft(added.map(a=>a.id));toast(`${added.length} pad(s) importados · ${mapped} nota(s) mapeadas`)}catch(error){console.error(error);if(!String(error?.message||error).toLowerCase().includes('cancel'))toast('Não foi possível importar os pads')}
}
async function importSingleAmbientFile(){
  try{let added=[];if(nativePadPicker()){let result=await mediaLibrary().pickAudioFiles({multiple:false});added=await addAmbientNativeFiles(result?.files||[])}else{return $('#ambientSinglePadFile').click()}if(added[0]){renderAmbientLibrary();assignAmbientAsset(added[0].id)}}catch(error){console.error(error);if(!String(error?.message||error).toLowerCase().includes('cancel'))toast('Não foi possível importar o pad')}
}
$('#newAmbientBank').onclick=()=>openAmbientBankEditor(null,true);$('#editAmbientBank').onclick=()=>openAmbientBankEditor(state.activeAmbientBankId,false);
$('#closeAmbientBankEditor').onclick=()=>{$('#ambientBankEditor').close();ambientBankDraft=null;editingAmbientBankId=null};
$('#saveAmbientBank').onclick=()=>{if(!ambientBankDraft)return;let name=$('#ambientBankNameInput').value.trim();if(!name)return toast('Digite um nome para o banco');ambientBankDraft.name=name;if(editingAmbientBankId){let i=state.ambientBanks.findIndex(b=>b.id===editingAmbientBankId);if(i>=0)state.ambientBanks[i]=ambientBankDraft}else state.ambientBanks.push(ambientBankDraft);state.activeAmbientBankId=ambientBankDraft.id;save();$('#ambientBankEditor').close();ambientBankDraft=null;editingAmbientBankId=null;stopAmbientNow();renderAmbientLive();toast('Banco salvo')};
$('#deleteAmbientBank').onclick=()=>{if(!editingAmbientBankId)return;if(state.ambientBanks.length<=1)return toast('Mantenha pelo menos um banco');let bank=state.ambientBanks.find(b=>b.id===editingAmbientBankId);if(!confirm(`Excluir o banco "${bank?.name||''}"? Os arquivos continuarão na biblioteca.`))return;state.ambientBanks=state.ambientBanks.filter(b=>b.id!==editingAmbientBankId);if(state.activeAmbientBankId===editingAmbientBankId)state.activeAmbientBankId=state.ambientBanks[0].id;save();$('#ambientBankEditor').close();ambientBankDraft=null;editingAmbientBankId=null;stopAmbientNow();renderAmbientLive();toast('Banco excluído')};
$('#duplicateAmbientBank').onclick=()=>{if(!ambientBankDraft)return;editingAmbientBankId=null;ambientBankDraft={id:`bank-${Date.now()}`,name:(ambientBankDraft.name||'BANCO')+' 2',slots:{...(ambientBankDraft.slots||{})}};$('#ambientBankEditorTitle').textContent='Duplicar banco';$('#ambientBankNameInput').value=ambientBankDraft.name;$('#deleteAmbientBank').hidden=true;$('#duplicateAmbientBank').hidden=true;renderAmbientAssignments()};
$('#ambientAutoImport').onclick=importAmbientFilesForBank;$('#ambientAutoMapLibrary').onclick=()=>{let mapped=autoMapAssetsToDraft();toast(mapped?`${mapped} nota(s) preenchidas`:'Não encontrei novos arquivos para mapear')};
$('#closeAmbientLibrary').onclick=()=>{$('#ambientLibraryDialog').close();ambientAssignContext=null};$('#ambientLibrarySearch').oninput=e=>renderAmbientLibrary(e.target.value);$('#ambientLibraryImport').onclick=importSingleAmbientFile;
$('#ambientPadFiles').onchange=async e=>{let added=await addAmbientWebFiles([...e.target.files]);e.target.value='';if(ambientBankDraft&&added.length){let mapped=autoMapAssetsToDraft(added.map(a=>a.id));toast(`${added.length} pad(s) importados · ${mapped} nota(s) mapeadas`)}};
$('#ambientSinglePadFile').onchange=async e=>{let added=await addAmbientWebFiles([...e.target.files].slice(0,1));e.target.value='';if(added[0]){renderAmbientLibrary();assignAmbientAsset(added[0].id)}};
$('#ambientVolume').oninput=e=>{let v=+e.target.value;state.ambientSettings.volume=v;$('#ambientValue').textContent=Math.round(v*100)+'%';if(ambientVoices.some(x=>x.native)&&nativeAmbientPlayer())mediaLibrary().setAmbientPadVolume({volume:v}).catch(console.warn);for(let voice of ambientVoices)if(voice.gain)voice.gain.gain.setTargetAtTime(Math.max(.0001,v),ctx().currentTime,.04);save()};
$('#stopAllPads').onclick=()=>stopAmbientNow();
renderAmbientControls();renderAmbientLive();
function renderLyrics(filter=''){let rows=state.lyrics.filter(x=>(String(x.title||'')+' '+String(x.artist||'')+' '+String(x.text||'')).toLowerCase().includes(filter.toLowerCase())),el=$('#setlistItems');el.classList.toggle('empty',!rows.length);el.innerHTML=rows.length?rows.map(x=>`<div class="setlist-row" data-id="${x.id}"><div><b>${clean(x.title)}</b><small>${clean(x.artist||'Sem artista')}</small></div><span>›</span></div>`).join(''):'Nenhuma letra salva.';el.querySelectorAll('.setlist-row').forEach(r=>r.onclick=()=>openLyric(+r.dataset.id))}
function openLyric(id){let x=state.lyrics.find(x=>x.id===id);if(!x)return;selectedLyric=id;$('#viewerTitle').textContent=x.title;$('#viewerArtist').textContent=x.artist||'Sem artista informado';$('#viewerText').textContent=x.text||'Esta música ainda não possui letra.';$('#lyricsViewer').showModal()}
function editLyric(id){let x=state.lyrics.find(x=>x.id===id);if(!x)return;selectedLyric=id;$('#lyricTitle').value=x.title;$('#lyricArtist').value=x.artist;$('#lyricText').value=x.text;$('#lyricTitle').scrollIntoView({behavior:'smooth',block:'center'})}
$('#closeViewer').onclick=()=>$('#lyricsViewer').close();$('#editFromViewer').onclick=()=>{$('#lyricsViewer').close();editLyric(selectedLyric)};
let lyricFont=22;$('#viewerLarger').onclick=()=>{$('#viewerText').style.fontSize=(lyricFont=Math.min(34,lyricFont+2))+'px'};$('#viewerSmaller').onclick=()=>{$('#viewerText').style.fontSize=(lyricFont=Math.max(14,lyricFont-2))+'px'};
function fillCurrentTrackInLyrics(){let t=currentTrack();if(!t)return toast('Escolha uma música no Player primeiro');selectedLyric=lyricForTrack(t)?.id||null;let x=selectedLyric?state.lyrics.find(y=>y.id===selectedLyric):null;$('#lyricTitle').value=x?.title||t.name;$('#lyricArtist').value=x?.artist||t.artist||'';$('#lyricText').value=x?.text||'';$('#lyricsTrackName').textContent=`${t.name} • ${t.artist||'Artista desconhecido'}`;$('#lyricText').focus()}
$('#useCurrentTrack').onclick=fillCurrentTrackInLyrics;
$('#newSong').onclick=()=>{selectedLyric=null;$('#lyricTitle').value='';$('#lyricArtist').value='';$('#lyricText').value='';$('#lyricTitle').focus()};
$('#saveLyric').onclick=()=>{let title=$('#lyricTitle').value.trim();if(!title)return toast('Digite o nome da música');let t=currentTrack(),existing=selectedLyric?state.lyrics.find(y=>y.id===selectedLyric):null;let shouldLink=t&&normalizeSongName(t.name)===normalizeSongName(title);let x={id:selectedLyric||Date.now(),title,artist:$('#lyricArtist').value.trim(),text:$('#lyricText').value,trackId:shouldLink?trackKey(t):(existing?.trackId||null)};let i=state.lyrics.findIndex(y=>y.id===x.id);i<0?state.lyrics.push(x):state.lyrics[i]=x;selectedLyric=x.id;save();renderLyrics();toast(shouldLink?'Letra salva e vinculada ao Player':'Letra salva neste aparelho')};
$('#deleteLyric').onclick=()=>{if(!selectedLyric)return;state.lyrics=state.lyrics.filter(x=>x.id!==selectedLyric);selectedLyric=null;save();renderLyrics();$('#newSong').click()};
$('#setlistSearch').oninput=e=>renderLyrics(e.target.value);
$('#searchLetras').onclick=()=>{let q=$('#webSong').value.trim()||$('#lyricTitle').value.trim();if(!q)return toast('Digite o nome da música');window.open('https://www.letras.mus.br/?q='+encodeURIComponent(q),'_blank','noopener')};
if(currentTrack())$('#lyricsTrackName').textContent=`${currentTrack().name} • ${currentTrack().artist||'Artista desconhecido'}`;renderLyrics();
window.addEventListener('keydown',e=>{if(currentPage==='drums'&&/^[1-9]$/.test(e.key)){let i=+e.key-1,el=$(`.drum-pad[data-i="${i}"]`);if(el)hitPad(i,el)}});

// =========================================================
// PULSAR v1.7.4 — PULSAR CONNECT em streaming: configuração + arquivos individuais
// =========================================================
const nexoSyncPlugin=()=>window.Capacitor?.Plugins?.NexoSync;
const isNativeNexoSync=()=>!!(window.Capacitor?.isNativePlatform?.()&&nexoSyncPlugin());
let syncSelectedPeer=null,syncShareStatusTimer=null,syncProgressHandle=null;
function syncAddress(host,port){return host&&port?`${host}:${port}`:'IP local indisponível'}
function stopSyncStatusPolling(){clearTimeout(syncShareStatusTimer);syncShareStatusTimer=null}
async function pollSyncShareStatus(){
  stopSyncStatusPolling();
  try{
    const status=await nexoSyncPlugin()?.getShareStatus();if(!status?.active)return;
    if(status.code)$('#syncShareCode').textContent=status.code;
    if($('#syncShareAddress'))$('#syncShareAddress').textContent=syncAddress(status.host,+status.port);
    const meta=$('#syncShareMeta');meta.classList.remove('is-preparing','is-ready','is-error');
    if(status.error){meta.classList.add('is-error');meta.textContent=`Erro ao preparar: ${status.error}`;setSyncStatus('Código ativo, mas houve erro ao preparar os arquivos.')}
    else if(status.ready){meta.classList.add('is-ready');meta.textContent=`PRONTO · ${status.audioFiles||0} arquivo(s) de Pad/Drum · ${syncFormatBytes(status.bytes)}${status.skippedFiles?` · ${status.skippedFiles} ignorado(s)`:''}`;setSyncStatus(status.warning?`Pronto para conectar · ${status.warning}`:'Pronto para o tablet conectar.');return}
    else{meta.classList.add('is-preparing');meta.textContent='Preparando configurações e arquivos…';setSyncStatus('Código criado. Preparando os dados para envio…')}
    syncShareStatusTimer=setTimeout(pollSyncShareStatus,700)
  }catch(error){console.warn('Status PULSAR Connect',error);syncShareStatusTimer=setTimeout(pollSyncShareStatus,1200)}
}
function openSyncCodeForPeer(peer){syncSelectedPeer=peer;$('#syncCodePeerName').textContent=peer.name||'Outro PULSAR';$('#syncCodeInput').value='';if($('#syncReceiveProgressWrap'))$('#syncReceiveProgressWrap').hidden=true;if($('#syncReceiveProgressBar'))$('#syncReceiveProgressBar').style.width='0%';if(!$('#syncCodeDialog').open)$('#syncCodeDialog').showModal();setTimeout(()=>$('#syncCodeInput').focus(),100)}
function syncNorm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\.[a-z0-9]{2,5}$/,'').replace(/[^a-z0-9]+/g,' ').trim()}
function syncTrackRef(track){return track?{name:track.name||'',artist:track.artist||'',album:track.album||'',fileName:track.fileName||'',duration:track.duration||0}:null}

async function ensureSyncLibrary(){
  if(playlist.length||!mediaLibrary())return;
  try{const result=await mediaLibrary().getSongs();playlist=(result.songs||[]).map(s=>({id:s.id,name:s.title||s.fileName||'Sem título',artist:s.artist||'Artista desconhecido',album:s.album||'Álbum desconhecido',folder:s.folder||'Músicas',duration:s.duration||0,dateAdded:s.dateAdded||0,fileName:s.fileName||'',nativeUri:s.uri}));relinkSyncedLibraryReferences();updateCounts()}catch(error){console.warn('Não foi possível preparar referências das playlists para o Sync',error)}
}
function countLegacySyncAudio(snapshot){let count=0;const walk=v=>{if(!v||typeof v!=='object')return;if(!Array.isArray(v)&&v.audioKey&&!v.nativeFileUri)count++;Object.values(v).forEach(walk)};walk(snapshot);return count}
function buildSyncState(){
  const snapshot=JSON.parse(JSON.stringify(state));
  const existingRefs=new Map((snapshot.syncPlaylistRefs||[]).map(x=>[String(x.playlistId),x.tracks||[]]));
  snapshot.syncPlaylistRefs=(state.playerPlaylists||[]).map(list=>{
    const current=(list.trackIds||[]).map(id=>playlist.find(t=>trackKey(t)===String(id))).filter(Boolean).map(syncTrackRef);
    return {playlistId:list.id,name:list.name,tracks:current.length?current:(existingRefs.get(String(list.id))||[])};
  });
  const currentFavorites=(state.playerFavorites||[]).map(id=>playlist.find(t=>trackKey(t)===String(id))).filter(Boolean).map(syncTrackRef);
  snapshot.syncFavoriteRefs=currentFavorites.length?currentFavorites:(snapshot.syncFavoriteRefs||[]);
  snapshot.syncGeneratedAt=Date.now();
  snapshot.syncSchema=1;
  return snapshot
}
function findSyncedTrack(ref){
  if(!ref)return null;
  const file=syncNorm(ref.fileName),name=syncNorm(ref.name),artist=syncNorm(ref.artist),duration=+ref.duration||0;
  let found=file&&playlist.find(t=>syncNorm(t.fileName)===file);if(found)return found;
  found=playlist.find(t=>syncNorm(t.name)===name&&(!artist||syncNorm(t.artist)===artist));if(found)return found;
  found=playlist.find(t=>syncNorm(t.name)===name&&(!duration||Math.abs((+t.duration||0)-duration)<3500));return found||null
}
function relinkSyncedLibraryReferences(){
  if(!playlist.length)return;
  let changed=false;
  for(const refGroup of state.syncPlaylistRefs||[]){
    const list=(state.playerPlaylists||[]).find(x=>String(x.id)===String(refGroup.playlistId));if(!list)continue;
    const ids=(refGroup.tracks||[]).map(findSyncedTrack).filter(Boolean).map(trackKey);
    if(ids.length||!(list.trackIds||[]).some(id=>playlist.some(t=>trackKey(t)===String(id)))){list.trackIds=[...new Set(ids)];changed=true}
  }
  if((state.syncFavoriteRefs||[]).length){state.playerFavorites=[...new Set(state.syncFavoriteRefs.map(findSyncedTrack).filter(Boolean).map(trackKey))];changed=true}
  if(changed)save()
}
function syncFormatBytes(bytes){let n=+bytes||0;if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;if(n<1073741824)return `${(n/1048576).toFixed(1)} MB`;return `${(n/1073741824).toFixed(2)} GB`}
function setSyncStatus(text){if($('#syncStatusText'))$('#syncStatusText').textContent=text}
function syncProgressLabel(info){
  const stage=info?.stage||'',current=+info?.current||0,total=+info?.total||0,bytes=+info?.bytes||0,totalBytes=+info?.totalBytes||0;
  if(stage==='connecting')return 'Conectando ao outro PULSAR…';
  if(stage==='preparing')return 'Conectado. O celular ainda está preparando a lista de arquivos…';
  if(stage==='manifest')return total?`Configuração recebida · ${total} arquivo(s) para transferir`:'Configuração recebida · nenhum áudio adicional';
  if(stage==='file'){
    const filePart=total?`${Math.min(Math.max(current,1),total)}/${total}`:'';
    const bytePart=totalBytes?`${syncFormatBytes(bytes)} / ${syncFormatBytes(totalBytes)}`:syncFormatBytes(bytes);
    return `Recebendo ${filePart}${filePart?' · ':''}${bytePart}`;
  }
  if(stage==='done')return `Transferência concluída · ${total} arquivo(s) · ${syncFormatBytes(bytes)}`;
  return 'Recebendo configurações e arquivos…'
}
function renderSyncReceiveProgress(info){
  const label=syncProgressLabel(info);setSyncStatus(label);
  const wrap=$('#syncReceiveProgressWrap'),text=$('#syncReceiveProgressText'),bytesEl=$('#syncReceiveProgressBytes'),bar=$('#syncReceiveProgressBar');
  if(!wrap)return;wrap.hidden=false;if(text)text.textContent=label;
  const bytes=+info?.bytes||0,totalBytes=+info?.totalBytes||0,current=+info?.current||0,total=+info?.total||0;
  let pct=0;if(totalBytes>0)pct=Math.max(0,Math.min(100,(bytes/totalBytes)*100));else if(total>0)pct=Math.max(0,Math.min(100,(current/total)*100));else if(info?.stage==='done')pct=100;
  if(bar)bar.style.width=pct.toFixed(1)+'%';
  if(bytesEl)bytesEl.textContent=totalBytes?`${syncFormatBytes(bytes)} de ${syncFormatBytes(totalBytes)} · ${pct.toFixed(0)}%`:(total?`${current} de ${total} arquivo(s)`: '');
}
async function attachSyncProgress(){
  try{
    if(syncProgressHandle?.remove)await syncProgressHandle.remove();
    syncProgressHandle=await nexoSyncPlugin()?.addListener?.('syncProgress',renderSyncReceiveProgress)
  }catch(error){console.warn('Progresso do PULSAR Connect indisponível',error);syncProgressHandle=null}
}
async function detachSyncProgress(){
  try{if(syncProgressHandle?.remove)await syncProgressHandle.remove()}catch{}
  syncProgressHandle=null
}
// =========================================================
// PULSAR v1.8 — PULSAR DRIVE via Android Storage Access Framework
// A pasta continua privada no Google Drive; o Android concede acesso somente
// à pasta escolhida. Áudios são baixados para cache local por banco.
// =========================================================
const nexoDrivePlugin=()=>window.Capacitor?.Plugins?.NexoDrive;
const isNativeNexoDrive=()=>!!(window.Capacitor?.isNativePlatform?.()&&nexoDrivePlugin());
let driveProgressHandle=null,driveLastLibrary=null,driveBusy=false;
function driveKey(v){return String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function drivePath(kind,bank,file){return `${kind}/${bank==='__ROOT__'?'':bank+'/'}${file||''}`.replace(/\/+/g,'/')}
function setDriveBusy(value,text=''){
  driveBusy=!!value;$$('#driveSyncCard button').forEach(b=>b.disabled=driveBusy);
  if(text&&$('#driveConfigState'))$('#driveConfigState').textContent=text
}
function renderDriveProgress(info){
  const wrap=$('#driveProgressWrap'),bar=$('#driveProgressBar'),text=$('#driveProgressText'),meta=$('#driveProgressMeta');if(!wrap)return;wrap.hidden=false;
  const current=+info?.current||0,total=+info?.total||0,bytes=+info?.bytes||0,totalBytes=+info?.totalBytes||0,stage=String(info?.stage||''),pct=stage==='done'?100:(totalBytes?Math.min(100,bytes/totalBytes*100):(total?Math.min(100,current/total*100):0));
  if(text){
    if(stage==='done')text.textContent=`Banco ${info.bankName||''} pronto offline`;
    else if(stage==='retrying')text.textContent=`Tentando novamente ${info.fileName||'arquivo'} · ${info.attempt||2}/${info.attempts||4}`;
    else if(stage==='skipped')text.textContent=`Arquivo pendente: ${info.fileName||'áudio'}`;
    else if(stage==='error')text.textContent=info.message||'Falha ao baixar banco';
    else text.textContent=`Baixando ${info.fileName||'arquivo'} · ${current}/${total}`;
  }
  if(meta){
    if(stage==='retrying'&&info?.message)meta.textContent=`Drive demorou para liberar o arquivo · nova tentativa automática`;
    else if(stage==='skipped')meta.textContent=`O restante do banco continuará sendo baixado`;
    else meta.textContent=totalBytes?`${syncFormatBytes(bytes)} de ${syncFormatBytes(totalBytes)} · ${pct.toFixed(0)}%`:`${current} de ${total}`;
  }
  if(bar)bar.style.width=pct.toFixed(1)+'%';if(stage==='done')setTimeout(()=>{wrap.hidden=true},1500)
}
async function attachDriveProgress(){try{if(driveProgressHandle?.remove)await driveProgressHandle.remove();driveProgressHandle=await nexoDrivePlugin()?.addListener?.('driveProgress',renderDriveProgress)}catch(error){console.warn('Progresso PULSAR Drive indisponível',error)}}
function driveBankCard(kind,bank){
  const display=bank.displayName||bank.name||'Banco',count=+bank.count||0,bytes=+bank.bytes||0,isPad=kind==='Pads',offline=isPad?(state.ambientBanks||[]).some(b=>{if(!b.driveManaged||driveKey(b.name)!==driveKey(display))return false;return Object.values(b.slots||{}).some(id=>{let a=ambientAsset(id);return !!(a?.nativeFileUri||a?.audioKey||a?.buffer)})}):(state.drumBanks||[]).some(b=>b.driveManaged&&driveKey(b.name)===driveKey(display)&&(b.pads||[]).some(p=>p.nativeFileUri||p.audioKey||p.buffer));
  return `<article class="drive-bank ${offline?'offline':''}" data-drive-kind="${clean(kind)}" data-drive-bank="${clean(bank.name)}"><span class="drive-bank-icon">${isPad?'≋':'◉'}</span><div><b>${clean(display)}</b><small>${count} arquivo${count===1?'':'s'} · ${syncFormatBytes(bytes)}${offline?' · OFFLINE':''}</small></div><button type="button">${offline?'ATUALIZAR':'BAIXAR'}</button></article>`
}
function renderDriveLibrary(result){
  driveLastLibrary=result||{padBanks:[],drumBanks:[]};const pads=result?.padBanks||[],drums=result?.drumBanks||[];
  $('#drivePadCount').textContent=pads.length;$('#driveDrumCount').textContent=drums.length;
  $('#drivePadBanks').innerHTML=pads.length?pads.map(b=>driveBankCard('Pads',b)).join(''):'<p>Nenhum banco encontrado em Pads.</p>';
  $('#driveDrumBanks').innerHTML=drums.length?drums.map(b=>driveBankCard('Drums',b)).join(''):'<p>Nenhum banco encontrado em Drums.</p>';
  $$('.drive-bank').forEach(card=>card.querySelector('button').onclick=()=>downloadDriveBank(card.dataset.driveKind,card.dataset.driveBank));
  linkCurrentAssetsToDrive(result)
}
function linkCurrentAssetsToDrive(result){
  let changed=false;
  const padBanks=result?.padBanks||[];
  for(const bank of state.ambientBanks||[]){
    const remote=padBanks.find(x=>driveKey(x.name)===driveKey(bank.name));if(!remote)continue;
    const byName=new Map((remote.files||[]).map(f=>[driveKey(f.name),f]));
    for(const assetId of Object.values(bank.slots||{})){
      const asset=ambientAsset(assetId);if(!asset||asset.driveRelativePath)continue;const remoteFile=byName.get(driveKey(asset.fileName||asset.name));if(!remoteFile)continue;
      asset.driveRelativePath=drivePath('Pads',remote.name,remoteFile.relativePath);asset.driveManaged=true;changed=true
    }
  }
  const drumFiles=[];for(const bank of result?.drumBanks||[])for(const f of bank.files||[])drumFiles.push({bank:bank.name,...f});
  const drumByName=new Map(drumFiles.map(f=>[driveKey(f.name),f]));
  for(const pad of state.pads||[]){if(pad.driveRelativePath)continue;const remote=drumByName.get(driveKey(pad.fileName||pad.name));if(!remote)continue;pad.driveRelativePath=drivePath('Drums',remote.bank,remote.relativePath);pad.driveManaged=true;changed=true}
  if(changed)save()
}
async function refreshDriveStatus(loadLibrary=false){
  if(!isNativeNexoDrive()){$('#driveDisconnected').hidden=false;$('#driveConnected').hidden=true;$('#driveConfigState').textContent='Disponível somente no APK Android';return}
  try{
    const status=await nexoDrivePlugin().getStatus();const connected=!!status?.connected;$('#driveDisconnected').hidden=connected;$('#driveConnected').hidden=!connected;$('#driveStatusDot').classList.toggle('connected',connected);
    if(!connected){$('#driveConfigState').textContent=status?.error||'Nenhuma pasta conectada';return}
    $('#driveFolderName').textContent=status.name||'LOUVORES';$('#driveConfigState').textContent=status.hasConfig?'Configuração encontrada no Drive':'Pasta pronta · ainda sem configuração salva';
    if(loadLibrary)await refreshDriveLibrary()
  }catch(error){console.error(error);$('#driveDisconnected').hidden=false;$('#driveConnected').hidden=true;$('#driveConfigState').textContent='Não foi possível acessar a pasta'}
}
async function refreshDriveLibrary(){
  if(!isNativeNexoDrive()||driveBusy)return;setDriveBusy(true,'Lendo Pads e Drums no Drive…');
  try{const result=await nexoDrivePlugin().scanLibrary();renderDriveLibrary(result);$('#driveConfigState').textContent='Biblioteca atualizada';toast('Biblioteca do Drive atualizada')}
  catch(error){console.error(error);$('#driveConfigState').textContent=error?.message||'Falha ao ler o Drive';toast('Não foi possível ler a biblioteca do Drive')}
  finally{setDriveBusy(false)}
}
function buildDriveState(){
  const snapshot=buildSyncState();snapshot.driveSchema=1;snapshot.driveGeneratedAt=Date.now();
  // Caminhos file:// e blobs pertencem ao aparelho atual. No outro aparelho,
  // o PULSAR religa os áudios pelo driveRelativePath ao baixar o banco.
  for(const a of snapshot.ambientLibrary||[]){delete a.audioKey;delete a.buffer;delete a.nativeFileUri}
  for(const p of snapshot.pads||[]){delete p.audioKey;delete p.buffer;delete p.nativeFileUri}
  for(const bank of snapshot.drumBanks||[])for(const p of bank.pads||[]){delete p.audioKey;delete p.buffer;delete p.nativeFileUri}
  return snapshot
}
function restoreDownloadedDriveRefs(imported){
  // Configurações podem vir antes dos áudios. Mantemos as referências lógicas
  // do Drive e o banco baixado depois preenche os file:// locais.
  return imported
}
async function downloadDriveBank(kind,bankName){
  if(driveBusy)return;setDriveBusy(true,`Preparando ${bankName==='__ROOT__'?'arquivos':bankName}…`);await attachDriveProgress();
  try{
    const result=await nexoDrivePlugin().downloadBank({kind,bankName});
    if(kind==='Pads')importDrivePadBank(result);else importDriveDrumBank(result);
    const failed=+result.failed||0;
    if(failed){
      const sample=(result.failedFiles||[]).slice(0,2).map(x=>x.name).filter(Boolean).join(', ');
      $('#driveConfigState').textContent=`${result.bankName} offline · ${result.total||0} arquivo(s) · ${failed} não baixado(s)${sample?` · ${sample}`:''}`;
      toast(`${result.bankName}: pronto com ${failed} arquivo(s) pendente(s)`)
    }else{
      $('#driveConfigState').textContent=`${result.bankName} disponível offline · ${result.total||0} arquivo(s)`;
      toast(`${result.bankName} pronto offline`)
    }
  }catch(error){
    console.error(error);
    const message=error?.message||String(error||'Falha no download');
    $('#driveConfigState').textContent=message;
    toast(message.length>74?message.slice(0,71)+'…':message)
  }
  finally{setDriveBusy(false)}
}
function importDrivePadBank(result){
  const bankName=result.bankName||'DRIVE',files=result.files||[];let bank=(state.ambientBanks||[]).find(b=>b.driveManaged&&driveKey(b.name)===driveKey(bankName));
  if(!bank){bank={id:`drive-bank-${Date.now()}-${driveKey(bankName)}`,name:bankName,slots:{},driveManaged:true};state.ambientBanks.push(bank)}
  const newAssets=[];
  for(const f of files){let asset=(state.ambientLibrary||[]).find(a=>a.driveSourceId===f.sourceId||a.driveRelativePath===f.driveRelativePath);if(!asset){asset={id:`drive-pad-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:String(f.name||'Pad').replace(/\.[^.]+$/,''),fileName:f.name||'Áudio',driveSourceId:f.sourceId,driveRelativePath:f.driveRelativePath,driveManaged:true};state.ambientLibrary.push(asset)}asset.nativeFileUri=f.fileUri;asset.fileName=f.name||asset.fileName;asset.driveSourceId=f.sourceId||asset.driveSourceId;asset.driveRelativePath=f.driveRelativePath||asset.driveRelativePath;asset.driveManaged=true;newAssets.push(asset)}
  rebuildAmbientAssetIndex();let mapped=0,remaining=[];bank.slots={};
  for(const asset of newAssets){let key=noteFromFilename(asset.fileName||asset.name);if(key&&!bank.slots[key]){bank.slots[key]=asset.id;mapped++}else remaining.push(asset)}
  for(const note of tonalNotes){if(bank.slots[note.key])continue;let asset=remaining.shift();if(!asset)break;bank.slots[note.key]=asset.id}
  bank.driveManaged=true;bank.driveOfflineAt=Date.now();bank.driveFileCount=files.length;state.activeAmbientBankId=bank.id;save();renderAmbientLive();if(mapped<Math.min(12,files.length))toast(`${bankName}: ${mapped} nota(s) reconhecida(s) pelo nome`)
}
function importDriveDrumBank(result){
  const bankName=result.bankName||'DRIVE',files=result.files||[],pads=files.map((f,i)=>({name:String(f.name||`PAD ${i+1}`).replace(/\.[^.]+$/,''),fileName:f.name||'Áudio',nativeFileUri:f.fileUri,driveSourceId:f.sourceId,driveRelativePath:f.driveRelativePath,driveManaged:true,color:padColors[i%padColors.length],volume:1}));
  let current=currentDrumBank();if(current)current.pads=cloneDrumPads(state.pads);
  let bank=(state.drumBanks||[]).find(b=>b.driveManaged&&driveKey(b.name)===driveKey(bankName));if(!bank){bank={id:`drive-drum-${Date.now()}-${driveKey(bankName)}`,name:bankName,pads:[],driveManaged:true};state.drumBanks.push(bank)}bank.pads=cloneDrumPads(pads);bank.driveOfflineAt=Date.now();bank.driveFileCount=files.length;state.activeDrumBankId=bank.id;state.pads=cloneDrumPads(bank.pads);editingPads=false;$('#editPads').textContent='EDITAR';save();renderDrums()
}
function openDriveFor(kind){openSyncDialog();setTimeout(async()=>{await refreshDriveStatus(true);let target=kind==='Drums'?$('#driveDrumBanks'):$('#drivePadBanks');target?.scrollIntoView({behavior:'smooth',block:'center'})},120)}
if($('#openDrivePads'))$('#openDrivePads').onclick=()=>openDriveFor('Pads');
if($('#openDriveDrums'))$('#openDriveDrums').onclick=()=>openDriveFor('Drums');
$('#driveConnect').onclick=async()=>{
  if(!isNativeNexoDrive())return toast('PULSAR Drive funciona no APK Android');
  try{setDriveBusy(true,'Escolha a pasta LOUVORES no Google Drive…');const status=await nexoDrivePlugin().selectRootFolder();$('#driveFolderName').textContent=status.name||'LOUVORES';toast('Pasta do Drive conectada');setDriveBusy(false);await refreshDriveStatus(true)}
  catch(error){if(!String(error?.message||error).toLowerCase().includes('cancel')){console.error(error);toast('Não foi possível conectar esta pasta')}}finally{setDriveBusy(false)}
};
$('#driveDisconnect').onclick=async()=>{if(!confirm('Desconectar a pasta do Drive deste aparelho? Os arquivos já baixados continuam offline.'))return;try{await nexoDrivePlugin()?.disconnect();driveLastLibrary=null;await refreshDriveStatus(false);toast('Drive desconectado')}catch(error){console.error(error)}};
$('#driveRefresh').onclick=refreshDriveLibrary;
$('#drivePushConfig').onclick=async()=>{
  if(driveBusy)return;setDriveBusy(true,'Salvando configurações no Drive…');
  try{await ensureSyncLibrary();if(driveLastLibrary)linkCurrentAssetsToDrive(driveLastLibrary);const result=await nexoDrivePlugin().saveConfig({stateJson:JSON.stringify(buildDriveState())});$('#driveConfigState').textContent=`Configuração salva · ${syncFormatBytes(result.bytes)}`;toast('Configuração salva no Drive')}
  catch(error){console.error(error);$('#driveConfigState').textContent=error?.message||'Falha ao salvar configuração';toast('Não foi possível salvar no Drive')}
  finally{setDriveBusy(false)}
};
$('#drivePullConfig').onclick=async()=>{
  if(driveBusy)return;if(!confirm('Restaurar as configurações do Drive neste aparelho? As configurações locais serão substituídas.'))return;setDriveBusy(true,'Baixando configurações…');
  try{const result=await nexoDrivePlugin().loadConfig();const imported=restoreDownloadedDriveRefs(JSON.parse(result.stateJson));localStorage.setItem('up-state',JSON.stringify(imported));localStorage.setItem('nexo-onboarding-v17','1');toast('Configuração restaurada do Drive');setTimeout(()=>location.reload(),650)}
  catch(error){console.error(error);$('#driveConfigState').textContent=error?.message||'Falha ao restaurar';toast(error?.message||'Não foi possível restaurar a configuração')}
  finally{setDriveBusy(false)}
};

function openSyncDialog(){
  $('#syncDialog').showModal();
  if(!isNativeNexoSync()&&!isNativeNexoDrive()){setSyncStatus('A conexão e os downloads ficam disponíveis no APK Android.');return}
  setSyncStatus('Pronto para sincronizar.');refreshDriveStatus(false)
}
$('#openSync').onclick=openSyncDialog;
if($('#openPulsarLibrary'))$('#openPulsarLibrary').onclick=openSyncDialog;
$('#closeSync').onclick=()=>$('#syncDialog').close();
$('#syncSend').onclick=async()=>{
  if(!isNativeNexoSync())return toast('Use o APK Android para transferir pela rede');
  $('#syncReceivePanel').hidden=true;$('#syncSharePanel').hidden=false;$('#syncShareCode').textContent='----';if($('#syncShareAddress'))$('#syncShareAddress').textContent='Obtendo IP…';
  const meta=$('#syncShareMeta');meta.className='sync-transfer-meta is-preparing';meta.textContent='Abrindo conexão local…';setSyncStatus('Criando código de conexão…');
  try{
    // v1.7.4: abre servidor + código primeiro; o Sync transfere configuração e depois cada áudio individualmente.
    const result=await nexoSyncPlugin().startShare();
    $('#syncShareName').textContent=result.deviceName||'PULSAR';$('#syncDeviceLabel').textContent=result.deviceName||'Este PULSAR';$('#syncShareCode').textContent=result.code||'----';if($('#syncShareAddress'))$('#syncShareAddress').textContent=syncAddress(result.host,+result.port);
    meta.textContent='Código pronto. Preparando configurações e arquivos…';setSyncStatus('Código criado. O tablet já pode usar o endereço exibido.');pollSyncShareStatus();
    try{
      await ensureSyncLibrary();const snapshot=buildSyncState(),legacy=countLegacySyncAudio(snapshot);
      const prepared=await nexoSyncPlugin().prepareShare({stateJson:JSON.stringify(snapshot)});
      meta.className='sync-transfer-meta is-ready';meta.textContent=`PRONTO · ${prepared.audioFiles||0} arquivo(s) de Pad/Drum · ${syncFormatBytes(prepared.bytes)}${prepared.skippedFiles?` · ${prepared.skippedFiles} ignorado(s)`:''}${legacy?` · ${legacy} áudio(s) antigo(s) precisam ser reimportados`:''}`;setSyncStatus(prepared.warning?`Pronto para conectar · ${prepared.warning}`:'Pronto para o tablet conectar.');stopSyncStatusPolling()
    }catch(error){
      console.error(error);let detail='';try{const status=await nexoSyncPlugin().getShareStatus();detail=status?.error||''}catch{}detail=detail||error?.message||'Falha desconhecida';
      meta.className='sync-transfer-meta is-error';meta.textContent=`ERRO: ${detail}`;setSyncStatus(`Não foi possível preparar: ${detail}`);toast('Veja o motivo mostrado na tela')
    }
  }catch(error){console.error(error);$('#syncSharePanel').hidden=true;setSyncStatus('Não foi possível iniciar o compartilhamento.');toast('Falha ao abrir a conexão local')}
};
$('#syncStopShare').onclick=async()=>{stopSyncStatusPolling();try{await nexoSyncPlugin()?.stopShare()}catch{}$('#syncSharePanel').hidden=true;setSyncStatus('Compartilhamento encerrado.')};
async function discoverNexoPeers(){
  if(!isNativeNexoSync())return;
  $('#syncSharePanel').hidden=true;$('#syncReceivePanel').hidden=false;let list=$('#syncPeerList');list.innerHTML='<p>Procurando outros PULSARs nesta rede...</p>';setSyncStatus('Procurando na rede Wi‑Fi...');
  try{
    const result=await nexoSyncPlugin().discoverPeers({durationMs:5000}),peers=result.peers||[];
    setSyncStatus(peers.length?`${peers.length} PULSAR${peers.length===1?'':'s'} encontrado${peers.length===1?'':'s'}.`:'Nenhum PULSAR compartilhando nesta rede.');
    list.innerHTML=peers.length?peers.map((p,i)=>`<div class="sync-peer" data-peer="${i}"><span>▣</span><div><b>${clean(p.name||'PULSAR')}</b><small>Rede local · pronto para conectar</small></div><button type="button">CONECTAR</button></div>`).join(''):'<p>Nenhum PULSAR encontrado. No celular, abra Sincronização e toque em ENVIAR DESTE PULSAR.</p>';
    list.querySelectorAll('[data-peer]').forEach(el=>el.querySelector('button').onclick=()=>openSyncCodeForPeer(peers[+el.dataset.peer]))
  }catch(error){console.error(error);list.innerHTML='<p>Não consegui procurar aparelhos. Confirme que os dois estão no mesmo Wi‑Fi.</p>';setSyncStatus('Falha na descoberta local.')}
}
$('#syncReceive').onclick=discoverNexoPeers;$('#syncRefreshPeers').onclick=discoverNexoPeers;
if($('#syncManualConnect'))$('#syncManualConnect').onclick=()=>{
  let value=$('#syncManualAddress').value.trim().replace(/^https?:\/\//i,'').replace(/\/.*$/,'');
  const pos=value.lastIndexOf(':');if(pos<1)return toast('Digite no formato IP:PORTA');
  const host=value.slice(0,pos).trim(),port=Number(value.slice(pos+1));
  if(!host||!Number.isInteger(port)||port<1||port>65535)return toast('Endereço inválido');
  openSyncCodeForPeer({name:`PULSAR · ${host}`,host,port})
};
$('#syncCodeCancel').onclick=()=>{$('#syncCodeDialog').close();syncSelectedPeer=null};
function applyReceivedNexo(stateJson,metaText='Sincronização concluída'){
  stopSyncStatusPolling();
  try{const imported=JSON.parse(stateJson);localStorage.setItem('up-state',JSON.stringify(imported));localStorage.setItem('nexo-onboarding-v17','1');toast(metaText);setTimeout(()=>location.reload(),650)}catch(error){console.error(error);toast('Os dados recebidos são inválidos')}
}
$('#syncCodeConfirm').onclick=async()=>{
  if(!syncSelectedPeer)return;let code=$('#syncCodeInput').value.replace(/\D/g,'').slice(0,4);if(code.length!==4)return toast('Digite os 4 números do código');
  let button=$('#syncCodeConfirm'),old=button.textContent;button.disabled=true;button.textContent='RECEBENDO...';setSyncStatus('Conectando ao outro PULSAR…');if($('#syncReceiveProgressWrap'))$('#syncReceiveProgressWrap').hidden=false;if($('#syncReceiveProgressText'))$('#syncReceiveProgressText').textContent='Conectando ao outro PULSAR…';if($('#syncReceiveProgressBytes'))$('#syncReceiveProgressBytes').textContent='';if($('#syncReceiveProgressBar'))$('#syncReceiveProgressBar').style.width='2%';
  await attachSyncProgress();
  try{
    let result=await nexoSyncPlugin().receiveFromPeer({host:syncSelectedPeer.host,port:+syncSelectedPeer.port,code});
    $('#syncCodeDialog').close();setSyncStatus(`Recebido · ${result.audioFiles||0} arquivo(s) · ${syncFormatBytes(result.bytes)}`);
    applyReceivedNexo(result.stateJson,'PULSAR copiado com sucesso')
  }catch(error){
    console.error(error);const message=String(error?.message||error||'Falha na transferência local');
    setSyncStatus(message);if($('#syncReceiveProgressText'))$('#syncReceiveProgressText').textContent=message;if($('#syncReceiveProgressBytes'))$('#syncReceiveProgressBytes').textContent='';toast(message.toLowerCase().includes('código')?'Código incorreto':'Falha na transferência · veja a mensagem')
  }finally{await detachSyncProgress();button.disabled=false;button.textContent=old}
};
$('#syncCodeInput').oninput=e=>e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);
$('#syncExportBackup').onclick=async()=>{
  if(!isNativeNexoSync())return toast('O backup completo funciona no APK Android');setSyncStatus('Preparando arquivo de backup...');
  try{await ensureSyncLibrary();let snapshot=buildSyncState(),legacy=countLegacySyncAudio(snapshot),result=await nexoSyncPlugin().exportBackup({stateJson:JSON.stringify(snapshot)});setSyncStatus(`Backup salvo · ${result.audioFiles||0} arquivo(s) · ${syncFormatBytes(result.bytes)}${legacy?` · ${legacy} áudio(s) antigo(s) fora do backup`:''}`);toast('Backup PULSAR salvo')}
  catch(error){console.error(error);if(!String(error?.message||error).toLowerCase().includes('cancel'))toast('Não foi possível salvar o backup');setSyncStatus('Pronto para enviar ou receber.')}
};
$('#syncImportBackup').onclick=async()=>{
  if(!isNativeNexoSync())return toast('A restauração completa funciona no APK Android');setSyncStatus('Escolha um arquivo .nexo...');
  try{let result=await nexoSyncPlugin().importBackup();setSyncStatus(`Backup lido · ${result.audioFiles||0} arquivo(s)`);applyReceivedNexo(result.stateJson,'Backup restaurado')}
  catch(error){console.error(error);if(!String(error?.message||error).toLowerCase().includes('cancel'))toast('Não foi possível restaurar este backup');setSyncStatus('Pronto para enviar ou receber.')}
};

// Tablet console: controls the SAME player backend; it never creates another Audio/MediaPlayer.
if($('#tabletPlay'))$('#tabletPlay').onclick=togglePlayer;if($('#tabletPrev'))$('#tabletPrev').onclick=()=>skipPlayer(-1);if($('#tabletNext'))$('#tabletNext').onclick=()=>skipPlayer(1);
if($('#tabletVolume'))$('#tabletVolume').oninput=e=>setPlayerVolume(+e.target.value);
if($('#tabletPitch'))$('#tabletPitch').oninput=e=>{let v=+e.target.value;state.playerSettings.pitch=v;$('#pitch').value=$('#nowPitch').value=v;$('#pitchValue').textContent=$('#nowPitchValue').textContent=$('#tabletPitchValue').textContent=(v>0?'+':'')+v+' st';queuePlaybackMix();save()};
if($('#tabletSpeed'))$('#tabletSpeed').oninput=e=>{let v=+e.target.value;state.playerSettings.speed=v;$('#nowSpeed').value=v;$('#nowSpeedValue').textContent=$('#tabletSpeedValue').textContent=Math.round(v*100)+'%';queuePlaybackMix();save()};
if($('#tabletEq'))$('#tabletEq').onclick=openEqualizer;if($('#tabletQueue'))$('#tabletQueue').onclick=()=>{renderQueue();$('#queueDialog').showModal()};if($('#tabletLyrics'))$('#tabletLyrics').onclick=()=>$('#nowLyrics').click();
function syncTabletControlValues(){
  if($('#tabletVolume'))$('#tabletVolume').value=state.playerSettings.volume;if($('#tabletVolumeValue'))$('#tabletVolumeValue').textContent=Math.round(state.playerSettings.volume*100)+'%';
  if($('#tabletPitch'))$('#tabletPitch').value=state.playerSettings.pitch;if($('#tabletPitchValue'))$('#tabletPitchValue').textContent=(state.playerSettings.pitch>0?'+':'')+state.playerSettings.pitch+' st';
  if($('#tabletSpeed'))$('#tabletSpeed').value=state.playerSettings.speed;if($('#tabletSpeedValue'))$('#tabletSpeedValue').textContent=Math.round(state.playerSettings.speed*100)+'%'
}
syncTabletControlValues();

// First launch on a tablet: offer local migration instead of showing an empty app.
function maybeShowTabletFirstRun(){
  const tablet=window.matchMedia('(min-width:600px)').matches;if(!tablet||!window.Capacitor?.isNativePlatform?.()||localStorage.getItem('nexo-onboarding-v17'))return;
  setTimeout(()=>{if(!$('#syncFirstRun').open)$('#syncFirstRun').showModal()},500)
}
$('#firstRunNew').onclick=()=>{localStorage.setItem('nexo-onboarding-v17','1');$('#syncFirstRun').close();toast('PULSAR pronto para configurar')};
$('#firstRunCopy').onclick=()=>{localStorage.setItem('nexo-onboarding-v17','1');$('#syncFirstRun').close();openSyncDialog();setTimeout(discoverNexoPeers,150)};
if($('#firstRunDrive'))$('#firstRunDrive').onclick=()=>{localStorage.setItem('nexo-onboarding-v17','1');$('#syncFirstRun').close();openSyncDialog();setTimeout(()=>$('#driveConnect')?.click(),180)};
maybeShowTabletFirstRun();


// =========================================================
// PULSAR v1.9 — identidade premium e splash de abertura.
// Apenas interface: não cria um segundo motor de áudio.
// =========================================================
(function initPulsarSplash(){
  const splash=document.getElementById('pulsarSplash');
  if(!splash)return;
  const finish=()=>{
    if(splash.classList.contains('leaving'))return;
    splash.classList.add('leaving');
    setTimeout(()=>splash.remove(),520);
  };
  requestAnimationFrame(()=>splash.classList.add('ready'));
  const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  setTimeout(finish,reduce?280:1650);
  splash.addEventListener('click',finish,{once:true});
})();
