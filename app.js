/* PULSAR bootstrap: keep the stable core intact and load feature upgrades afterwards. */
(()=>{
  const load=(src,onload)=>{const s=document.createElement('script');s.src=src;s.async=false;if(onload)s.onload=onload;s.onerror=()=>console.error('PULSAR: falha ao carregar',src);document.head.appendChild(s)};
  load('app-core-v21.js?v=20261004',()=>load('drum-pad-v22.js?v=20261004'));
})();
