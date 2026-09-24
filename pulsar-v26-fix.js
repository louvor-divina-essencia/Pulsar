/* PULSAR 2.6 — compatibilidade de estado após reconstrução visual */
(() => {
  const q=s=>document.querySelector(s);
  function ensureNowSource(){
    const brand=q('.p26-now-brand');if(!brand||q('#nowSource'))return;
    const src=document.createElement('small');src.id='nowSource';src.className='p26-now-source';src.textContent='Biblioteca local';src.hidden=true;brand.appendChild(src);
  }
  function getPlayerState(){
    let position=0,duration=0,playing=false;
    try{if(typeof playerPosition!=='undefined')position=+playerPosition||0}catch{}
    try{if(typeof playerDuration!=='undefined')duration=+playerDuration||0}catch{}
    try{if(typeof playerPlaying!=='undefined')playing=!!playerPlaying}catch{}
    return {position,duration,playing};
  }
  function fmtMs(ms){try{return typeof fmt==='function'?fmt((+ms||0)/1000):'0:00'}catch{return '0:00'}}
  function updateHomeState(){
    const bar=q('#p26HomeBar');if(!bar)return;const st=getPlayerState();let track=null;try{track=typeof currentTrack==='function'?currentTrack():null}catch{}
    const total=st.duration||(+track?.duration||0);bar.style.width=(total?Math.max(0,Math.min(100,st.position/total*100)):0)+'%';
    const c=q('#p26HomeCurrent'),d=q('#p26HomeDuration'),play=q('#p26HomePlay');if(c)c.textContent=fmtMs(st.position);if(d)d.textContent=fmtMs(total);if(play)play.classList.toggle('playing',st.playing);
  }
  function updateTone(){
    const display=q('#p26ToneDisplay'),pitch=q('#nowPitch');if(!display||!pitch)return;
    const v=+pitch.value||0,key=(q('#nowKey')?.textContent||'').replace(/^TOM\s*/i,'').trim()||'—';
    display.textContent=v===0?key:(v>0?`+${v}`:`${v}`)+' st';
  }
  function init(){ensureNowSource();setInterval(()=>{if(document.hidden)return;ensureNowSource();updateHomeState();updateTone()},350)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
