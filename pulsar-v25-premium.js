/* PULSAR 2.5 — reformulação premium completa (Metrônomo preservado) */
(() => {
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const safe = value => typeof clean === 'function' ? clean(value) : String(value ?? '').replace(/[&<>"']/g,'');
  const hasFn = name => typeof window[name] === 'function' || typeof globalThis[name] === 'function';

  const pageMeta = {
    home: ['Início','Sua central musical'],
    player: ['Player','Música, tom e reprodução'],
    library: ['Biblioteca','Seu acervo local e na nuvem'],
    ambient: ['Pads','Pads tonais e ambientes'],
    drums: ['Drum Pad','Samples mapeados do seu jeito'],
    lyrics: ['Letras / Setlist','Letras e organização para tocar'],
    studio: ['Studio','Grave ideias e performances'],
    settings: ['Configurações','Ajustes do PULSAR']
  };

  function markBodyPage(id){
    document.body.dataset.pulsarPage=id||'home';
    document.body.classList.toggle('p25-metronome-legacy',id==='metronome');
  }

  function polishTopbar(){
    const top=q('.topbar'),brand=q('.brand'),status=q('.status');
    if(!top||top.dataset.p25)return;
    top.dataset.p25='1';top.classList.add('p25-topbar');
    if(brand){
      brand.classList.add('p25-brand');
      const strong=brand.querySelector('strong'),small=brand.querySelector('small');
      if(strong)strong.textContent='PULSAR';
      if(small)small.textContent='SUA MÚSICA NO PRÓXIMO NÍVEL';
    }
    if(status){
      status.classList.add('p25-top-actions');
      [...status.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).forEach(n=>n.remove());
      status.querySelector('.dot')?.remove();
      const sync=q('#openSync'),full=q('#fullscreenBtn');
      if(sync){sync.textContent='☁';sync.title='Biblioteca PULSAR';sync.classList.add('p25-head-button');}
      if(full){full.textContent='⛶';full.title='Tela cheia';full.classList.add('p25-head-button');}
      if(!q('#p25HeadSearch')){
        const search=document.createElement('button');search.id='p25HeadSearch';search.className='p25-head-button';search.type='button';search.textContent='⌕';search.title='Buscar músicas';
        search.onclick=()=>{go('library');setTimeout(()=>q('#p25LibrarySearch')?.focus(),120)};
        status.prepend(search);
      }
      if(!q('#p25HeadProfile')){
        const profile=document.createElement('button');profile.id='p25HeadProfile';profile.className='p25-head-button p25-profile';profile.type='button';profile.textContent='P';profile.title='PULSAR';profile.onclick=()=>go('settings');status.append(profile);
      }
    }
  }

  function currentTrackSafe(){try{return typeof currentTrack==='function'?currentTrack():null}catch{return null}}
  function trackAnalysisSafe(track){try{return state.trackAnalysis?.[trackKey(track)]||null}catch{return null}}

  function ensureHome(){
    const home=q('#home .nexo-home');if(!home||home.dataset.p25)return;home.dataset.p25='1';q('#home')?.classList.add('p25-home');
    const head=home.querySelector('.home-command-head');
    if(head){head.innerHTML='<div><small>SEU ESPAÇO MUSICAL</small><h1>Central PULSAR</h1><p>Performance, estudo e criação em um só lugar.</p></div><span class="p25-ready"><i></i>PRONTO</span>';}
    const now=document.createElement('section');now.className='p25-home-now';now.id='p25HomeNow';now.innerHTML=`
      <button type="button" class="p25-home-now-main">
        <span class="p25-home-art"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M7 58h17l5-13 8 29 8-38 8 22h9"/><circle cx="50" cy="50" r="38"/></svg></span>
        <span class="p25-home-now-copy"><small>TOCANDO AGORA</small><b id="p25HomeNowTitle">Escolha uma música</b><em id="p25HomeNowMeta">Biblioteca PULSAR</em><span class="p25-home-progress"><i id="p25HomeProgress"></i></span><span class="p25-home-times"><small id="p25HomeCurrent">0:00</small><small id="p25HomeDuration">0:00</small></span></span>
      </button>
      <button id="p25HomePlay" type="button" class="p25-home-play">▶</button>`;
    now.querySelector('.p25-home-now-main').onclick=()=>{if(currentTrackSafe()){try{q('#nowPlaying')?.showModal()}catch{go('player')}}else go('player')};
    now.querySelector('#p25HomePlay').onclick=()=>q('#playerFocusPlay')?.click();
    head?.after(now);

    const grid=home.querySelector('.pulsar-tool-grid');
    if(grid){
      const desc={player:'Ouça, analise BPM/TOM e transpose.',metro:'Tempo preciso para ensaio e estudo.',drums:'Seis pads base e mapeamento manual.',pads:'Camadas tonais para tocar ao vivo.',library:'Drive e arquivos disponíveis offline.'};
      grid.querySelectorAll('.tool-tile').forEach(btn=>{
        const key=btn.classList.contains('tool-player')?'player':btn.classList.contains('tool-metro')?'metro':btn.classList.contains('tool-drums')?'drums':btn.classList.contains('tool-pads')?'pads':btn.classList.contains('tool-library')?'library':'';
        if(key&&!btn.querySelector('.p25-tool-desc')){const em=document.createElement('em');em.className='p25-tool-desc';em.textContent=desc[key];btn.querySelector('.tool-copy')?.append(em)}
      });
      if(!q('#p25LyricsTile')){
        const b=document.createElement('button');b.id='p25LyricsTile';b.className='tool-tile p25-tool-lyrics';b.type='button';b.innerHTML='<span class="tool-glyph p25-glyph-text">≡</span><span class="tool-copy"><small>REPERTÓRIO</small><b>Letras / Setlist</b><em class="p25-tool-desc">Tenha letras e repertórios sempre à mão.</em></span>';b.onclick=()=>go('lyrics');grid.appendChild(b);
      }
      if(!q('#p25SettingsTile')){
        const b=document.createElement('button');b.id='p25SettingsTile';b.className='tool-tile p25-tool-settings';b.type='button';b.innerHTML='<span class="tool-glyph p25-glyph-text">⚙</span><span class="tool-copy"><small>PREFERÊNCIAS</small><b>Configurações</b><em class="p25-tool-desc">Ajuste o PULSAR ao seu fluxo.</em></span>';b.onclick=()=>go('settings');grid.appendChild(b);
      }
    }
    if(!q('#p25QuickAccess')){
      const quick=document.createElement('section');quick.id='p25QuickAccess';quick.className='p25-quick-access';quick.innerHTML='<div class="p25-section-title"><div><small>ACESSO RÁPIDO</small><b>Continue de onde parou</b></div></div><div class="p25-quick-grid"><button data-quick="favorites"><span>♡</span><b>Favoritas</b></button><button data-quick="recent"><span>◷</span><b>Recentes</b></button><button data-quick="downloads"><span>⇩</span><b>Downloads</b></button><button data-quick="playlists"><span>☷</span><b>Playlists</b></button></div>';
      home.appendChild(quick);
      quick.querySelector('[data-quick="favorites"]').onclick=()=>{go('player');setTimeout(()=>q('[data-smart="favorites"]')?.click(),100)};
      quick.querySelector('[data-quick="recent"]').onclick=()=>{go('player');setTimeout(()=>q('[data-smart="recent"]')?.click(),100)};
      quick.querySelector('[data-quick="downloads"]').onclick=()=>go('library');
      quick.querySelector('[data-quick="playlists"]').onclick=()=>{go('player');setTimeout(()=>q('#playerTabs [data-view="playlists"]')?.click(),100)};
    }
  }

  function updateHomeNow(){
    const box=q('#p25HomeNow');if(!box)return;const t=currentTrackSafe();
    const title=q('#p25HomeNowTitle'),meta=q('#p25HomeNowMeta'),play=q('#p25HomePlay'),bar=q('#p25HomeProgress'),cur=q('#p25HomeCurrent'),dur=q('#p25HomeDuration');
    if(!t){title.textContent='Escolha uma música';meta.textContent='Biblioteca PULSAR';play.textContent='▶';bar.style.width='0%';cur.textContent='0:00';dur.textContent='0:00';return}
    title.textContent=t.name||t.fileName||'Música';meta.textContent=[t.artist&&t.artist!=='<unknown>'?t.artist:'',t.album&&t.album!=='<unknown>'?t.album:''].filter(Boolean).join(' · ')||'Biblioteca PULSAR';
    play.textContent=typeof playerPlaying!=='undefined'&&playerPlaying?'Ⅱ':'▶';
    const p=+playerPosition||0,d=+playerDuration||((+t.duration||0));bar.style.width=(d?Math.max(0,Math.min(100,p/d*100)):0)+'%';cur.textContent=fmt(p/1000);dur.textContent=fmt(d/1000);
  }

  function makeLibraryPage(){
    if(q('#library'))return;
    const main=q('main');if(!main)return;
    const section=document.createElement('section');section.id='library';section.className='page p25-library-page';section.innerHTML=`
      <div class="p25-page-head"><button class="p25-back" type="button">‹</button><div><small>PULSAR CLOUD</small><h2>Biblioteca</h2><p>Seu acervo local e na nuvem, organizado sem ocupar espaço à toa.</p></div><button id="p25LibrarySync" class="p25-primary-small" type="button">↻ Sincronizar</button></div>
      <div class="p25-library-search"><span>⌕</span><input id="p25LibrarySearch" placeholder="Buscar músicas, artistas, pastas ou bancos..."><button id="p25LibraryClear" type="button">×</button></div>
      <div class="p25-library-filters"><button class="active" data-filter="all">Todos</button><button data-filter="device">No dispositivo</button><button data-filter="drive">No Drive</button><button data-filter="favorites">Favoritas</button><button data-filter="downloads">Downloads</button></div>
      <section class="p25-drive-hero"><div class="p25-drive-orbit"><span>☁</span><i></i></div><div><small>GOOGLE DRIVE</small><h3>Seu acervo principal na nuvem</h3><p>Sincronize o catálogo e deixe offline somente o que realmente vai usar.</p><span id="p25DriveStatus">Conecte sua pasta PULSAR Library</span></div><button id="p25DriveOpen" type="button">ABRIR BIBLIOTECA</button></section>
      <div id="p25DriveSection"><div class="p25-section-title"><div><small>PASTAS E BANCOS</small><b>Biblioteca PULSAR</b></div><button id="p25SeeDrive" type="button">GERENCIAR ›</button></div><div id="p25DriveBanks" class="p25-drive-banks"></div></div>
      <div id="p25LocalSection"><div class="p25-section-title"><div><small>MÚSICAS</small><b>No seu aparelho</b></div><button id="p25RefreshLocal" type="button">ATUALIZAR</button></div><div id="p25LibrarySongs" class="p25-library-songs"></div></div>`;
    main.appendChild(section);
    section.querySelector('.p25-back').onclick=()=>go('home');
    q('#p25LibrarySync').onclick=q('#p25DriveOpen').onclick=q('#p25SeeDrive').onclick=()=>openSyncDialog?.();
    q('#p25RefreshLocal').onclick=()=>{go('player');setTimeout(()=>q('#scanDeviceMusic')?.click(),100)};
    q('#p25LibrarySearch').oninput=()=>renderPremiumLibrary();q('#p25LibraryClear').onclick=()=>{q('#p25LibrarySearch').value='';renderPremiumLibrary()};
    section.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{section.querySelectorAll('[data-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');section.dataset.filter=b.dataset.filter;renderPremiumLibrary()});
    section.dataset.filter='all';
  }

  function driveBankRows(){
    try{
      const lib=(typeof driveLastLibrary!=='undefined'&&driveLastLibrary)||{};
      const pad=(lib.padBanks||[]).map(b=>({...b,kind:'PAD'}));
      const drum=(lib.drumBanks||[]).map(b=>({...b,kind:'DRUM'}));
      return [...pad,...drum];
    }catch{return []}
  }
  function bankOfflineCount(bank){try{return (bank.files||[]).filter(f=>state.driveOfflineAssets?.[f.sourceId]?.fileUri).length}catch{return 0}}
  function renderPremiumLibrary(){
    const page=q('#library');if(!page)return;const filter=page.dataset.filter||'all',term=(q('#p25LibrarySearch')?.value||'').trim().toLowerCase();
    const local=q('#p25LocalSection'),driveSec=q('#p25DriveSection');
    local.hidden=filter==='drive'||filter==='downloads';driveSec.hidden=filter==='device'||filter==='favorites';
    const banks=driveBankRows().filter(b=>!term||`${b.name||''} ${b.displayName||''} ${b.kind}`.toLowerCase().includes(term));
    const driveList=q('#p25DriveBanks');if(driveList){driveList.innerHTML=banks.length?banks.map(b=>{const total=(b.files||[]).length||+b.count||0,off=bankOfflineCount(b),offline=off>0;return `<button class="p25-drive-bank" type="button"><span class="p25-bank-icon">${b.kind==='DRUM'?'D':'P'}</span><span><small>${b.kind}</small><b>${safe(b.displayName||b.name||'Banco')}</b><em>${total} arquivo${total===1?'':'s'}</em><i class="${offline?'offline':''}">${offline?`${off}/${total} offline`:'Disponível na nuvem'}</i></span><strong>›</strong></button>`}).join(''):'<div class="p25-empty">Sincronize o Drive para ver seus bancos aqui.</div>';driveList.querySelectorAll('.p25-drive-bank').forEach(b=>b.onclick=()=>openSyncDialog?.())}
    let rows=(typeof playlist!=='undefined'?playlist:[]).map((s,i)=>({s,i}));
    if(filter==='favorites')rows=rows.filter(({s})=>state.playerFavorites?.includes(trackKey(s)));
    if(term)rows=rows.filter(({s})=>`${s.name||''} ${s.artist||''} ${s.album||''} ${s.folder||''}`.toLowerCase().includes(term));
    const songs=q('#p25LibrarySongs');if(songs){songs.innerHTML=rows.length?rows.slice(0,80).map(({s,i})=>{const a=trackAnalysisSafe(s),artist=s.artist&&s.artist!=='<unknown>'?s.artist:'Artista desconhecido';return `<button class="p25-library-song" type="button" data-i="${i}"><span class="p25-song-thumb"><i></i></span><span class="p25-song-copy"><b>${safe(s.name||s.fileName||'Música')}</b><small>${safe(artist)}${a?.bpm?` · ${Math.round(a.bpm)} BPM`:''}${a?.key?` · ${safe(a.key)}`:''}</small></span><em>${fmt((+s.duration||0)/1000)}</em><strong>›</strong></button>`}).join(''):'<div class="p25-empty">Nenhuma música carregada. Toque em ATUALIZAR para ler o aparelho.</div>';songs.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{const i=+b.dataset.i;go('player');setTimeout(()=>{try{loadSong(i,true)}catch{}},80)})}
    try{const status=q('#p25DriveStatus');const plugin=window.Capacitor?.Plugins?.NexoDrive;if(plugin?.getStatus)plugin.getStatus().then(s=>{status.textContent=s?.connected?`Conectado a ${s.name||'PULSAR Library'}`:'Conecte sua pasta PULSAR Library';status.classList.toggle('connected',!!s?.connected)}).catch(()=>{})}catch{}
  }

  function makeSettingsPage(){
    if(q('#settings'))return;const main=q('main');if(!main)return;
    const section=document.createElement('section');section.id='settings';section.className='page p25-settings-page';section.innerHTML=`
      <div class="p25-page-head"><button class="p25-back" type="button">‹</button><div><small>PULSAR</small><h2>Configurações</h2><p>Ajustes rápidos para sua experiência.</p></div></div>
      <div class="p25-settings-hero"><span class="p25-settings-logo">P</span><div><small>PULSAR</small><h3>Central musical</h3><p>Performance, biblioteca, Pads e gravação no mesmo ambiente.</p></div></div>
      <div class="p25-settings-group"><small>BIBLIOTECA</small><button id="p25SettingsLibrary" type="button"><span>☁</span><div><b>Biblioteca PULSAR</b><em>Drive, sincronização e conteúdo offline</em></div><strong>›</strong></button><button id="p25SettingsRescan" type="button"><span>↻</span><div><b>Atualizar músicas do aparelho</b><em>Refazer leitura da biblioteca local</em></div><strong>›</strong></button></div>
      <div class="p25-settings-group"><small>INTERFACE</small><label><span>◫</span><div><b>Player flutuante</b><em>Mostrar mini player fora da tela do Player</em></div><input id="p25MiniToggle" type="checkbox" checked></label><button id="p25ResetMini" type="button"><span>⌖</span><div><b>Redefinir posição do mini player</b><em>Voltar para a posição padrão</em></div><strong>›</strong></button><button id="p25FullScreen" type="button"><span>⛶</span><div><b>Tela cheia</b><em>Ocultar barras do navegador quando possível</em></div><strong>›</strong></button></div>
      <div class="p25-settings-group"><small>SOBRE</small><div class="p25-about-row"><span>✦</span><div><b>PULSAR 2.5</b><em>Interface Premium · criado por Gabriel Müller</em></div></div></div>`;
    main.appendChild(section);section.querySelector('.p25-back').onclick=()=>go('home');q('#p25SettingsLibrary').onclick=()=>openSyncDialog?.();q('#p25SettingsRescan').onclick=()=>{go('player');setTimeout(()=>q('#scanDeviceMusic')?.click(),80)};q('#p25FullScreen').onclick=()=>q('#fullscreenBtn')?.click();q('#p25ResetMini').onclick=()=>{state.playerUi??={};state.playerUi.miniPosition=null;state.playerUi.miniCollapsed=false;save();const m=q('#miniPlayer');if(m){m.classList.remove('custom-position','collapsed');m.removeAttribute('style')}toast('Mini player redefinido')};
    const toggle=q('#p25MiniToggle');state.playerUi??={};state.playerUi.premiumMiniEnabled??=true;toggle.checked=state.playerUi.premiumMiniEnabled;toggle.onchange=()=>{state.playerUi.premiumMiniEnabled=toggle.checked;save();q('#miniPlayer')?.classList.toggle('p25-user-hidden',!toggle.checked)};
  }

  function premiumDock(){
    const dock=q('.dock');if(!dock||dock.dataset.p25)return;dock.dataset.p25='1';dock.classList.add('p25-dock');dock.innerHTML=`<button data-p25-go="home" class="active"><span class="p25-nav-icon">⌂</span><span>Início</span></button><button data-p25-go="library"><span class="p25-nav-icon">♫</span><span>Biblioteca</span></button><button data-p25-go="player" class="p25-center-nav"><span class="p25-center-orb"><i></i><i></i><i></i><i></i></span><span>Player</span></button><button data-p25-go="lyrics"><span class="p25-nav-icon">≡</span><span>Setlist</span></button><button data-p25-go="settings"><span class="p25-nav-icon">⚙</span><span>Ajustes</span></button>`;dock.querySelectorAll('[data-p25-go]').forEach(b=>b.onclick=()=>go(b.dataset.p25Go));
  }
  function syncDockActive(id){const dock=q('.p25-dock');if(!dock)return;dock.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.p25Go===id));if(['ambient','drums','studio','metronome'].includes(id))dock.querySelectorAll('button').forEach(b=>b.classList.remove('active'))}

  function premiumPageHeads(){
    q('#drums')?.classList.add('p25-screen','p25-drums');q('#ambient')?.classList.add('p25-screen','p25-ambient');q('#lyrics')?.classList.add('p25-screen','p25-lyrics');q('#player')?.classList.add('p25-screen','p25-player');
    const heads=[['#drums .page-title','PERFORMANCE','Drum Pad','Mapeie seus samples e toque sem distrações.'],['#ambient .page-title','PERFORMANCE','Pads','Pads tonais e ambientes para tocar ao vivo.'],['#lyrics .page-title','REPERTÓRIO','Letras / Setlist','Organize letras e acompanhe suas músicas.']];
    heads.forEach(([sel,small,title,sub])=>{const el=q(sel);if(!el)return;const copy=el.querySelector('div');if(copy){copy.querySelector('small')&&(copy.querySelector('small').textContent=small);copy.querySelector('h2')&&(copy.querySelector('h2').textContent=title);let p=copy.querySelector('p');if(!p){p=document.createElement('p');copy.appendChild(p)}p.textContent=sub}});
    const hint=q('#drums .hint');if(hint)hint.textContent='Seus samples ficam na Biblioteca PULSAR. Edite cada Pad e escolha manualmente o som que deseja usar.';
    const quick=q('#drums .drive-quickbar b');if(quick)quick.textContent='Samples disponíveis para mapear · nuvem ou offline';
  }

  function makeNowPlayerPremium(){
    const dlg=q('#nowPlaying'),content=dlg?.querySelector('.now-content');if(!dlg||!content||dlg.dataset.p25)return;dlg.dataset.p25='1';dlg.classList.add('p25-now-playing');
    const top=content.querySelector('.now-top');if(top)top.classList.add('p25-now-top');
    const hero=content.querySelector('.now-hero-v14')||content.querySelector('.now-hero');if(hero){
      hero.classList.add('p25-now-hero');
      if(!hero.querySelector('.p25-now-cover')){const art=document.createElement('div');art.className='p25-now-cover';art.innerHTML='<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="36"/><path d="M8 56h17l6-13 8 28 8-36 8 21h10"/><path d="M63 39l18 11-18 11z"/></svg>';hero.prepend(art)}
    }
    const info=content.querySelector('.now-info');if(info)info.classList.add('p25-now-info');
    if(!q('#p25PitchCard')){
      const mix=content.querySelector('.now-mix');
      const card=document.createElement('section');card.id='p25PitchCard';card.className='p25-pitch-card';card.innerHTML='<div class="p25-pitch-head"><div><small>TRANSPOSIÇÃO</small><b>Tom da música</b><span>Altere o tom sem mudar a velocidade.</span></div><button id="p25PitchReset" type="button">↻ Original</button></div><div class="p25-pitch-step"><button id="p25PitchMinus" type="button">−</button><div><b id="p25PitchBig">0 st</b><small id="p25PitchKey">TOM ATUAL</small></div><button id="p25PitchPlus" type="button">＋</button></div>';
      if(mix)mix.before(card);else content.appendChild(card);
      const set=v=>{const slider=q('#nowPitch');if(!slider)return;const min=+slider.min||-12,max=+slider.max||12;slider.value=Math.max(min,Math.min(max,v));slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));updatePitchCard()};
      q('#p25PitchMinus').onclick=()=>set((+q('#nowPitch')?.value||0)-1);q('#p25PitchPlus').onclick=()=>set((+q('#nowPitch')?.value||0)+1);q('#p25PitchReset').onclick=()=>set(0);q('#nowPitch')?.addEventListener('input',updatePitchCard);
    }
    const volumeLabel=q('#nowVolume')?.closest('label');volumeLabel?.classList.add('p25-volume-line');
    const mix=content.querySelector('.now-mix');if(mix){mix.classList.add('p25-now-mix');qa('#nowPlaying .now-mix label').forEach(l=>{if(l.querySelector('#nowPitch'))l.classList.add('p25-native-pitch-hidden')})}
  }
  function updatePitchCard(){const slider=q('#nowPitch'),big=q('#p25PitchBig'),key=q('#p25PitchKey');if(!slider||!big)return;const v=+slider.value||0;big.textContent=(v>0?'+':'')+v+' st';const detected=q('#nowKey')?.textContent?.replace(/^TOM\s*/i,'').trim();if(key)key.textContent=detected&&detected!=='—'?`BASE ${detected}`:'TOM ATUAL'}

  function polishPlayerLibrary(){
    const p=q('#player');if(!p)return;const head=p.querySelector('.player-head');if(head){head.classList.add('p25-page-head','p25-player-head');const copy=head.querySelector('.player-title-copy');if(copy){copy.querySelector('small')&&(copy.querySelector('small').textContent='PULSAR PLAYER');copy.querySelector('h2')&&(copy.querySelector('h2').textContent='Player');copy.querySelector('p')&&(copy.querySelector('p').textContent='Biblioteca, BPM, tom e reprodução em um fluxo mais limpo.')}}
    const focus=q('#playerFocusCard');focus?.classList.add('p25-player-focus');q('#songList')?.classList.add('p25-song-list');q('.player-search-v14')?.classList.add('p25-player-search');q('#playerTabs')?.classList.add('p25-player-tabs');
  }

  function polishDialogs(){
    ['#syncDialog','#padEditor','#ambientBankEditor','#ambientLibraryDialog','#queueDialog','#playlistDialog','#newPlaylistDialog','#lyricsViewer'].forEach(sel=>q(sel)?.classList.add('p25-dialog'));
    q('#syncDialog')?.classList.add('p25-library-dialog');q('#padEditor')?.classList.add('p25-pad-editor');
  }

  function polishStudio(){
    const studio=q('#studio');if(!studio)return;studio.classList.add('p25-screen','p25-studio');const title=studio.querySelector('.studio-title');title?.classList.add('p25-page-head');const copy=title?.querySelector('div');if(copy){copy.querySelector('small')&&(copy.querySelector('small').textContent='PULSAR STUDIO');copy.querySelector('h2')&&(copy.querySelector('h2').textContent='Studio');copy.querySelector('p')&&(copy.querySelector('p').textContent='Grave ideias, voz, Pads e Drum com roteamento independente.')}
  }

  function wrapGo(){
    if(typeof go!=='function'||go.__p25)return;const original=go;go=function(id){markBodyPage(id);original(id);syncDockActive(id);if(id==='library')renderPremiumLibrary();if(id==='home')updateHomeNow();if(id==='studio')polishStudio();setTimeout(()=>{if(id==='library')renderPremiumLibrary();if(id==='home')updateHomeNow()},80)};go.__p25=true;
  }

  function observePlayer(){
    setInterval(()=>{if(document.hidden)return;if(document.body.dataset.pulsarPage==='home')updateHomeNow();if(q('#nowPlaying')?.open)updatePitchCard()},700);
  }

  function init(){
    document.body.classList.add('pulsar-premium-v25');markBodyPage(typeof currentPage!=='undefined'?currentPage:'home');
    polishTopbar();ensureHome();makeLibraryPage();makeSettingsPage();premiumDock();premiumPageHeads();makeNowPlayerPremium();polishPlayerLibrary();polishDialogs();polishStudio();wrapGo();syncDockActive(typeof currentPage!=='undefined'?currentPage:'home');renderPremiumLibrary();observePlayer();
    q('#openPulsarLibrary')&&(q('#openPulsarLibrary').onclick=()=>go('library'));
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
