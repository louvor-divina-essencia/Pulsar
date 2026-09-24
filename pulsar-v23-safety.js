/* Compatibilidade interna para os controles ocultos no PULSAR 2.3 */
(() => {
  function hiddenInput(parent,id,value,min='0',max='1',step='.01'){
    if(document.getElementById(id)||!parent)return;
    const input=document.createElement('input');input.id=id;input.type='range';input.value=value;input.min=min;input.max=max;input.step=step;input.hidden=true;parent.appendChild(input);
  }
  function hiddenSpan(parent,id,text){if(document.getElementById(id)||!parent)return;const span=document.createElement('span');span.id=id;span.textContent=text;span.hidden=true;parent.appendChild(span)}
  function restoreInternalControls(){
    const drums=document.getElementById('drums');
    hiddenInput(drums,'drumVolume','.9');
    hiddenInput(drums,'drumReverb','0');
    const player=document.getElementById('player');
    hiddenInput(player,'nowSpeed','1','.5','1.5','.05');hiddenSpan(player,'nowSpeedValue','100%');
    hiddenInput(player,'tabletSpeed','1','.5','1.5','.05');hiddenSpan(player,'tabletSpeedValue','100%');
    const sync=document.getElementById('syncDialog');
    if(sync&&!document.getElementById('syncSharePanel')){const el=document.createElement('section');el.id='syncSharePanel';el.hidden=true;sync.appendChild(el)}
    if(sync&&!document.getElementById('syncReceivePanel')){const el=document.createElement('section');el.id='syncReceivePanel';el.hidden=true;sync.appendChild(el)}
  }
  function init(){restoreInternalControls();setTimeout(restoreInternalControls,1200)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
