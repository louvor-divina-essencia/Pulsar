/* PULSAR 2.6 — reconstrução visual fiel aos mockups aprovados */
(() => {
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const safe = v => typeof clean === 'function' ? clean(v) : String(v ?? '').replace(/[&<>"']/g, '');
  const svg = {
    pulse:`<svg viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="p26g" x1="0" x2="1"><stop stop-color="#20e8ff"/><stop offset=".55" stop-color="#2b8cff"/><stop offset="1" stop-color="#a64dff"/></linearGradient></defs><circle cx="48" cy="48" r="32" fill="none" stroke="url(#p26g)" stroke-width="4"/><ellipse cx="48" cy="50" rx="42" ry="13" fill="none" stroke="url(#p26g)" stroke-width="4" opacity=".72"/><path d="M25 52h9l4-12 5 26 6-36 6 29 5-15 5 8h8" fill="none" stroke="url(#p26g)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    play:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`,
    library:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6l2 2h8v12H4z"/><path d="M8 11h8M8 15h5"/></svg>`,
    pads:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="2"/><rect x="14" y="4" width="6" height="6" rx="2"/><rect x="4" y="14" width="6" height="6" rx="2"/><rect x="14" y="14" width="6" height="6" rx="2"/></svg>`,
    drum:`<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v8c0 1.7 3.1 3 7 3s7-1.3 7-3V7M8 10v6M16 10v6"/></svg>`,
    sliders:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v16M12 4v16M18 4v16"/><circle cx="6" cy="9" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="18" cy="7" r="2"/></svg>`,
    doc:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h4M9 12h7M9 16h5"/></svg>`,
    gear:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>`,
    search:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/></svg>`,
    cloud:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h11a4 4 0 0 0 .3-8A6.5 6.5 0 0 0 6 8.6 4.7 4.7 0 0 0 7 18z"/></svg>`,
    heart:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8c0 5-8 11-8 11S4 13 4 8a4 4 0 0 1 7-2.6A4 4 0 0 1 20 8z"/></svg>`,
    clock:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>`,
    download:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4M5 20h14"/></svg>`,
    list:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>`,
    home:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8v9h-6v-6H9v6H3z"/></svg>`
  };

  function callGo(id){ try{ if(typeof go === 'function') go(id); }catch(e){ console.warn(e); } }
  function currentTrackSafe(){ try{return typeof currentTrack === 'function' ? currentTrack() : null}catch{return null} }
  function fmtSafe(ms){ try{return typeof fmt==='function'?fmt((+ms||0)/1000):'0:00'}catch{return '0:00'} }

  function rebuildTopbar(){
    const top=q('.topbar'); if(!top || top.dataset.p26) return;
    top.dataset.p26='1'; top.className='topbar p26-topbar';
    top.innerHTML=`
      <button class="p26-brand" type="button" aria-label="Início"><span class="p26-brand-logo">${svg.pulse}</span><span><b>PULSAR</b><small>SUA MÚSICA NO PRÓXIMO NÍVEL</small></span></button>
      <div class="p26-head-actions">
        <button id="p26HeaderSearch" type="button" aria-label="Buscar">${svg.search}</button>
        <button id="openSync" type="button" aria-label="Biblioteca PULSAR" class="p26-notify">${svg.cloud}<i></i></button>
        <button id="p26HeaderProfile" type="button" aria-label="Configurações"><span>P</span></button>
      </div>`;
    top.querySelector('.p26-brand').onclick=()=>callGo('home');
    q('#p26HeaderSearch').onclick=()=>{callGo('library');setTimeout(()=>q('#p25LibrarySearch')?.focus(),140)};
    q('#openSync').onclick=()=>{try{if(typeof openSyncDialog==='function')openSyncDialog();else q('#syncDialog')?.showModal()}catch{}};
    q('#p26HeaderProfile').onclick=()=>callGo('settings');
  }

  function rebuildDock(){
    const dock=q('.dock'); if(!dock || dock.dataset.p26) return;
    dock.dataset.p26='1'; dock.className='dock p26-dock';
    dock.innerHTML=`
      <button data-p26-go="home" type="button">${svg.home}<span>Início</span></button>
      <button data-p26-go="library" type="button">${svg.library}<span>Biblioteca</span></button>
      <button data-p26-go="player" class="p26-dock-orb" type="button"><i>${svg.pulse}</i><span>Player</span></button>
      <button data-p26-go="lyrics" type="button">${svg.doc}<span>Setlist</span></button>
      <button data-p26-go="settings" type="button">${svg.gear}<span>Ajustes</span></button>`;
    dock.querySelectorAll('[data-p26-go]').forEach(btn=>btn.onclick=()=>{
      const id=btn.dataset.p26Go;
      if(id==='player' && currentTrackSafe()) { try{q('#nowPlaying')?.showModal();return}catch{} }
      callGo(id);
    });
  }

  function rebuildHome(){
    const section=q('#home'); const root=section?.querySelector('.nexo-home'); if(!section||!root||root.dataset.p26) return;
    root.dataset.p26='1'; section.classList.add('p26-home');
    root.innerHTML=`
      <section class="p26-home-now" id="p26HomeNow">
        <button class="p26-home-now-main" id="p26HomeNowOpen" type="button">
          <span class="p26-home-cover"><i></i>${svg.pulse}</span>
          <span class="p26-home-track"><small>TOCANDO AGORA</small><b id="p26HomeTitle">Escolha uma música</b><em id="p26HomeMeta">Biblioteca PULSAR</em><span class="p26-home-bar"><i id="p26HomeBar"></i></span><span class="p26-home-time"><small id="p26HomeCurrent">0:00</small><small id="p26HomeDuration">0:00</small></span></span>
        </button>
        <button id="p26HomePlay" class="p26-home-play" type="button">${svg.play}</button>
      </section>
      <div class="p26-section-heading"><span>PRINCIPAIS RECURSOS</span><button type="button" id="p26AllTools">VER TODOS ›</button></div>
      <div class="p26-feature-grid">
        <button class="p26-feature p26-feature-player" data-go="player" type="button"><i>${svg.play}</i><b>Player</b><small>Reproduza músicas com ferramentas avançadas.</small><strong>›</strong><span class="p26-feature-art bars"></span></button>
        <button class="p26-feature p26-feature-library" data-go="library" type="button"><i>${svg.library}</i><b>Biblioteca</b><small>Organize e gerencie suas músicas.</small><strong>›</strong><span class="p26-feature-art folders"></span></button>
        <button class="p26-feature p26-feature-pads" data-go="ambient" type="button"><i>${svg.pads}</i><b>Pads</b><small>Dispare sons e camadas durante sua música.</small><strong>›</strong><span class="p26-feature-art pads"></span></button>
        <button class="p26-feature p26-feature-drums" data-go="drums" type="button"><i>${svg.drum}</i><b>Drum Pad</b><small>Bateria e percussões na ponta dos dedos.</small><strong>›</strong><span class="p26-feature-art drum"></span></button>
        <button class="p26-feature p26-feature-studio" data-go="studio" type="button"><i>${svg.sliders}</i><b>Studio</b><small>Grave, crie e organize suas ideias.</small><strong>›</strong><span class="p26-feature-art sliders"></span></button>
        <button class="p26-feature p26-feature-lyrics" data-go="lyrics" type="button"><i>${svg.doc}</i><b>Letras / Setlist</b><small>Tenha letras e repertórios sempre à mão.</small><strong>›</strong><span class="p26-feature-art doc"></span></button>
        <button class="p26-feature p26-feature-settings p26-feature-wide" data-go="settings" type="button"><i>${svg.gear}</i><span><b>Configurações</b><small>Ajuste o app do seu jeito.</small></span><strong>›</strong></button>
      </div>
      <div class="p26-section-heading p26-quick-title"><span>ACESSO RÁPIDO</span></div>
      <div class="p26-quick-grid">
        <button data-quick="favorites" type="button">${svg.heart}<span>Favoritas</span></button>
        <button data-quick="recent" type="button">${svg.clock}<span>Recentes</span></button>
        <button data-quick="downloads" type="button">${svg.download}<span>Downloads</span></button>
        <button data-quick="metronome" type="button"><span class="p26-metro-icon">♩</span><span>Metrônomo</span></button>
      </div>`;
    root.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{
      const id=b.dataset.go;
      if(id==='player'&&currentTrackSafe()){try{q('#nowPlaying')?.showModal();return}catch{}}
      callGo(id);
    });
    q('#p26AllTools').onclick=()=>callGo('library');
    q('#p26HomeNowOpen').onclick=()=>{if(currentTrackSafe()){try{q('#nowPlaying')?.showModal();return}catch{}}callGo('player')};
    q('#p26HomePlay').onclick=()=>q('#playerFocusPlay')?.click();
    root.querySelector('[data-quick="favorites"]').onclick=()=>{callGo('player');setTimeout(()=>q('[data-smart="favorites"]')?.click(),100)};
    root.querySelector('[data-quick="recent"]').onclick=()=>{callGo('player');setTimeout(()=>q('[data-smart="recent"]')?.click(),100)};
    root.querySelector('[data-quick="downloads"]').onclick=()=>callGo('library');
    root.querySelector('[data-quick="metronome"]').onclick=()=>callGo('metronome');
  }

  function updateHome(){
    const t=currentTrackSafe(); if(!q('#p26HomeNow')) return;
    const title=q('#p26HomeTitle'),meta=q('#p26HomeMeta'),play=q('#p26HomePlay'),bar=q('#p26HomeBar'),cur=q('#p26HomeCurrent'),dur=q('#p26HomeDuration');
    if(!t){title.textContent='Escolha uma música';meta.textContent='Biblioteca PULSAR';bar.style.width='0%';cur.textContent='0:00';dur.textContent='0:00';return}
    title.textContent=t.name||t.fileName||'Música';
    meta.textContent=[t.artist&&t.artist!=='<unknown>'?t.artist:'',t.album&&t.album!=='<unknown>'?t.album:''].filter(Boolean).join(' · ')||'Biblioteca PULSAR';
    const pos=+globalThis.playerPosition||0, total=+globalThis.playerDuration||+t.duration||0;
    bar.style.width=(total?Math.min(100,Math.max(0,pos/total*100)):0)+'%'; cur.textContent=fmtSafe(pos); dur.textContent=fmtSafe(total);
    if(play) play.classList.toggle('playing',!!globalThis.playerPlaying);
  }

  function upgradePlayerPage(){
    const page=q('#player'); if(!page||page.dataset.p26) return; page.dataset.p26='1'; page.classList.add('p26-player-page');
    const head=page.querySelector('.player-head'); if(head){head.classList.add('p26-page-head');const copy=head.querySelector('.player-title-copy');if(copy){const small=copy.querySelector('small'),h=copy.querySelector('h2'),p=copy.querySelector('p');if(small)small.textContent='PULSAR AUDIO';if(h)h.textContent='Player';if(p)p.textContent='Sua música com leitura de BPM, tom e transposição.'}}
    const search=page.querySelector('.player-search-v14');search?.classList.add('p26-player-search');
    const focus=q('#playerFocusCard');focus?.classList.add('p26-player-focus');
    q('#playerTabs')?.classList.add('p26-player-tabs');q('#songList')?.classList.add('p26-song-list');
    q('#smartCollections')?.classList.add('p26-smart');
  }

  function upgradeNowPlaying(){
    const dlg=q('#nowPlaying'),content=dlg?.querySelector('.now-content'); if(!dlg||!content||dlg.dataset.p26) return;
    dlg.dataset.p26='1'; dlg.classList.add('p26-now-playing'); content.classList.add('p26-now-content');
    const top=content.querySelector('.now-top');
    if(top&&!top.querySelector('.p26-now-brand')){
      const brand=document.createElement('div');brand.className='p26-now-brand';brand.innerHTML=`<span>${svg.pulse}</span><div><b>PULSAR</b><small>SUA MÚSICA NO PRÓXIMO NÍVEL</small></div>`;
      const center=top.querySelector('div'); center?.replaceWith(brand);
      top.classList.add('p26-now-top');
      const actions=top.querySelector('.now-top-actions'); if(actions){actions.classList.add('p26-now-actions');const eq=q('#nowEq');if(eq)eq.remove();}
    }
    const hero=content.querySelector('.now-hero-v14,.now-hero'); if(hero){hero.classList.add('p26-now-hero');if(!hero.querySelector('.p26-album-art')){const art=document.createElement('div');art.className='p26-album-art';art.innerHTML=`<div class="p26-stage"><i></i><i></i><i></i><span>${svg.pulse}</span></div>`;hero.prepend(art)}}
    const info=content.querySelector('.now-info');info?.classList.add('p26-now-info');
    content.querySelector('.now-timeline')?.classList.add('p26-now-timeline');
    content.querySelector('.now-transport')?.classList.add('p26-now-transport');
    content.querySelector('.now-quick-row-v14')?.classList.add('p26-now-quick');
    content.querySelector('.study-tools-v14')?.classList.add('p26-study-tools');

    const mix=content.querySelector('.now-mix'); if(mix&&!mix.dataset.p26){
      mix.dataset.p26='1';mix.classList.add('p26-now-mix');
      const pitch=q('#nowPitch'),volume=q('#nowVolume'),speed=q('#nowSpeed');
      speed?.closest('label')?.remove();
      if(pitch){
        const pitchLabel=pitch.closest('label');
        const tone=document.createElement('section');tone.className='p26-tone-card';tone.innerHTML=`<div class="p26-tone-head"><span class="p26-tone-icon">♪</span><div><b>Transposição / Tom</b><small>Altere o tom da música sem mudar a velocidade.</small></div><button id="p26PitchReset" type="button">↻ Resetar</button></div><div class="p26-tone-controls"><button id="p26PitchMinus" type="button">−</button><div class="p26-tone-value"><b id="p26ToneDisplay">0</b><small>TOM ATUAL</small></div><button id="p26PitchPlus" type="button">＋</button></div>`;
        mix.parentNode.insertBefore(tone,mix);
        pitchLabel.classList.add('p26-hidden-range');tone.appendChild(pitchLabel);
        const syncTone=()=>{const v=+pitch.value||0;const key=q('#nowKey')?.textContent?.replace(/^TOM\s*/i,'').trim()||'—';q('#p26ToneDisplay').textContent=v===0?key:(v>0?`+${v}`:`${v}`)+' st'};
        const setPitch=v=>{pitch.value=Math.max(+pitch.min||-12,Math.min(+pitch.max||12,v));pitch.dispatchEvent(new Event('input',{bubbles:true}));syncTone()};
        q('#p26PitchMinus').onclick=()=>setPitch((+pitch.value||0)-1);q('#p26PitchPlus').onclick=()=>setPitch((+pitch.value||0)+1);q('#p26PitchReset').onclick=()=>setPitch(0);pitch.addEventListener('input',syncTone);syncTone();
      }
      if(volume){const label=volume.closest('label');if(label){const card=document.createElement('div');card.className='p26-volume-card';label.parentNode.insertBefore(card,label);card.appendChild(label)}}
    }
  }

  function upgradeLibrary(){
    const page=q('#library'); if(!page)return; page.classList.add('p26-library');
    q('.p25-drive-hero')?.classList.add('p26-drive-hero'); q('#p25DriveBanks')?.classList.add('p26-drive-banks'); q('#p25LibrarySongs')?.classList.add('p26-library-songs');
    const search=q('.p25-library-search');search?.classList.add('p26-library-search'); q('.p25-library-filters')?.classList.add('p26-library-filters');
    const h=q('#library .p25-page-head');h?.classList.add('p26-page-head');
  }

  function upgradeDrums(){
    const page=q('#drums'); if(!page)return; page.classList.add('p26-drums');
    const title=page.querySelector('.page-title');title?.classList.add('p26-page-head');
    q('#drumGrid')?.classList.add('p26-drum-grid');
    const quick=page.querySelector('.drive-quickbar');quick?.classList.add('p26-drum-library-note');
    const hint=page.querySelector('.hint');if(hint)hint.textContent='Edite qualquer Pad, escolha um sample da Biblioteca PULSAR, teste antes de usar e mantenha apenas o que quiser offline.';
    const add=q('#addDrumPad');if(add)add.textContent='＋ NOVO PAD';
  }

  function upgradeAmbient(){
    const page=q('#ambient'); if(!page)return; page.classList.add('p26-ambient');
    page.querySelector('.page-title')?.classList.add('p26-page-head');q('#noteGrid')?.classList.add('p26-note-grid');
    page.querySelector('.tonal-bank-panel')?.classList.add('p26-bank-panel'); page.querySelector('.tonal-controls-v15')?.classList.add('p26-tonal-controls');
    page.querySelector('.drive-quickbar')?.classList.add('p26-pad-library-note');
  }

  function upgradeStudio(){
    const page=q('#studio'); if(!page)return; page.classList.add('p26-studio'); page.querySelector('.page-title')?.classList.add('p26-page-head');
    const rec=page.querySelector('.studio-rec-card'); if(rec)rec.classList.add('p26-studio-rec');
    const routing=q('#studioRouting'); if(routing){routing.classList.add('p26-routing'); if(rec&&routing.parentElement===rec)rec.after(routing)}
    page.querySelector('.studio-shortcuts')?.classList.add('p26-studio-shortcuts'); page.querySelector('.studio-takes')?.classList.add('p26-takes');
  }

  function upgradeLyrics(){const page=q('#lyrics');if(!page)return;page.classList.add('p26-lyrics');page.querySelector('.page-title')?.classList.add('p26-page-head');page.querySelector('.setlist-layout')?.classList.add('p26-setlist-layout');}
  function upgradeSettings(){const page=q('#settings');if(!page)return;page.classList.add('p26-settings');page.querySelector('.p25-page-head')?.classList.add('p26-page-head');}
  function upgradeDialogs(){qa('dialog:not(#nowPlaying):not(#equalizerDialog)').forEach(d=>d.classList.add('p26-dialog'));q('#padEditor')?.classList.add('p26-pad-editor');q('#syncDialog')?.classList.add('p26-sync-dialog');}

  function syncDock(){
    const active=q('main > .page.active')?.id || document.body.dataset.pulsarPage || 'home';
    qa('.p26-dock [data-p26-go]').forEach(b=>b.classList.toggle('active',b.dataset.p26Go===active || (active==='studio'&&b.dataset.p26Go==='player'&&false)));
  }

  function patchDynamicRender(){
    if(typeof renderDrums==='function'&&!renderDrums.__p26){const old=renderDrums;renderDrums=function(){const r=old.apply(this,arguments);setTimeout(()=>q('#drumGrid')?.classList.add('p26-drum-grid'));return r};renderDrums.__p26=true;}
    if(typeof renderAmbientGrid==='function'&&!renderAmbientGrid.__p26){const old=renderAmbientGrid;renderAmbientGrid=function(){const r=old.apply(this,arguments);setTimeout(()=>q('#noteGrid')?.classList.add('p26-note-grid'));return r};renderAmbientGrid.__p26=true;}
  }

  function init(){
    document.body.classList.add('pulsar-pixel-v26'); rebuildTopbar(); rebuildDock(); rebuildHome(); upgradePlayerPage(); upgradeNowPlaying(); upgradeLibrary(); upgradeDrums(); upgradeAmbient(); upgradeStudio(); upgradeLyrics(); upgradeSettings(); upgradeDialogs(); patchDynamicRender(); syncDock(); updateHome();
    const observer=new MutationObserver(()=>{syncDock();upgradeStudio();upgradeLibrary();upgradeSettings();});
    const main=q('main');if(main)observer.observe(main,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
    setInterval(()=>{if(!document.hidden){updateHome();syncDock();if(q('#nowPlaying')?.open)upgradeNowPlaying();}},500);
    setTimeout(()=>{upgradeStudio();upgradeLibrary();upgradeSettings();upgradeDialogs();},800);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
