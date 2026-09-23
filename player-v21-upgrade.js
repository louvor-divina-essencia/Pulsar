(() => {
  const q = selector => document.querySelector(selector);
  const analyzerPlugin = () => window.Capacitor?.Plugins?.AudioAnalyzer;
  const analysisJobs = new Set();
  const pitchNames = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
  const pitchMap = {C:0,'B#':0,'C#':1,DB:1,D:2,'D#':3,EB:3,E:4,FB:4,'E#':5,F:5,'F#':6,GB:6,G:7,'G#':8,AB:8,A:9,'A#':10,BB:10,B:11,CB:11};

  function transposeKey(value, semitones) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const minor = /m$/i.test(raw);
    const root = raw.replace(/m$/i, '').replace('♯', '#').replace('♭', 'b');
    const pc = pitchMap[root.toUpperCase()];
    if (pc === undefined) return raw;
    const shifted = (pc + Math.round(Number(semitones) || 0) + 120) % 12;
    return pitchNames[shifted] + (minor ? 'm' : '');
  }

  function analysisForCurrentTrack() {
    try {
      const track = currentTrack();
      return track ? state.trackAnalysis?.[trackKey(track)] : null;
    } catch {
      return null;
    }
  }

  function syncPitchSelector() {
    let pitch = 0;
    try { pitch = Math.max(-12, Math.min(12, Math.round(Number(state.playerSettings.pitch) || 0))); } catch {}
    ['#nowPitch', '#pitch', '#tabletPitch'].forEach(selector => {
      const input = q(selector);
      if (input) {
        input.min = '-12';
        input.max = '12';
        input.step = '1';
        input.value = String(pitch);
      }
    });
    const label = `${pitch > 0 ? '+' : ''}${pitch} st`;
    ['#nowPitchValue', '#pitchValue', '#tabletPitchValue'].forEach(selector => {
      const el = q(selector);
      if (el) el.textContent = label;
    });
    const number = q('#pitchSelectorValue');
    if (number) number.textContent = `${pitch > 0 ? '+' : ''}${pitch}`;

    const analysis = analysisForCurrentTrack();
    const original = analysis?.key || null;
    const shifted = original ? transposeKey(original, pitch) : null;
    const originalEl = q('#pitchOriginalKey');
    const shiftedEl = q('#pitchShiftedKey');
    const route = q('#pitchKeyRoute');
    if (originalEl) originalEl.textContent = original || '—';
    if (shiftedEl) shiftedEl.textContent = shifted || '—';
    if (route) route.textContent = original ? `${original} → ${shifted}` : 'TOM ORIGINAL → ATUAL';
    q('#pitchSelectorV21')?.classList.toggle('shifted', pitch !== 0);
  }

  function setPitch(value) {
    const pitch = Math.max(-12, Math.min(12, Math.round(Number(value) || 0)));
    const input = q('#nowPitch') || q('#pitch') || q('#tabletPitch');
    if (!input) return;
    input.value = String(pitch);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    syncPitchSelector();
  }

  function installPitchSelector() {
    const pitch = q('#nowPitch');
    if (!pitch || q('#pitchSelectorV21')) return;
    ['#nowPitch', '#pitch', '#tabletPitch'].forEach(selector => {
      const input = q(selector);
      if (input) { input.min = '-12'; input.max = '12'; input.step = '1'; }
    });

    const oldLabel = pitch.closest('label');
    if (!oldLabel) return;
    const panel = document.createElement('div');
    panel.id = 'pitchSelectorV21';
    panel.className = 'pitch-selector-v21';
    panel.innerHTML = `
      <div class="pitch-selector-head">
        <span><small>TRANSPOSIÇÃO</small><b id="pitchKeyRoute">TOM ORIGINAL → ATUAL</b></span>
        <button id="pitchReset" type="button">ORIGINAL</button>
      </div>
      <div class="pitch-selector-main">
        <button id="pitchDown" type="button" aria-label="Baixar um semitom">−</button>
        <div><strong id="pitchSelectorValue">0</strong><small>SEMITONS</small><span id="nowPitchValue">0 st</span></div>
        <button id="pitchUp" type="button" aria-label="Subir um semitom">＋</button>
      </div>
      <div class="pitch-range-slot"></div>
      <div class="pitch-key-preview">
        <span><small>ORIGINAL</small><b id="pitchOriginalKey">—</b></span><i>→</i><span><small>AGORA</small><b id="pitchShiftedKey">—</b></span>
      </div>`;
    panel.querySelector('.pitch-range-slot').appendChild(pitch);
    oldLabel.replaceWith(panel);
    q('#pitchDown').onclick = () => setPitch((Number(state.playerSettings.pitch) || 0) - 1);
    q('#pitchUp').onclick = () => setPitch((Number(state.playerSettings.pitch) || 0) + 1);
    q('#pitchReset').onclick = () => setPitch(0);
    pitch.addEventListener('input', () => requestAnimationFrame(syncPitchSelector));
    q('#tabletPitch')?.addEventListener('input', () => requestAnimationFrame(syncPitchSelector));
    q('#pitch')?.addEventListener('input', () => requestAnimationFrame(syncPitchSelector));
    syncPitchSelector();
  }

  async function analyzeNativeTrack(track, silent = true, force = false) {
    if (!track?.nativeUri) return false;
    const analyzer = analyzerPlugin();
    if (!analyzer?.analyze) return false;
    const id = trackKey(track);
    const known = state.trackAnalysis?.[id];
    if (!force && known?.engine === 'android-v21' && known?.bpm && known?.key) return true;
    if (analysisJobs.has(id)) return false;
    analysisJobs.add(id);

    const button = q('#analyzeBtn');
    const oldText = button?.textContent;
    if (button && !silent) { button.disabled = true; button.textContent = 'ANALISANDO...'; }
    if (trackKey(currentTrack()) === id) {
      if (!known?.bpm && q('#nowBpm')) q('#nowBpm').textContent = 'BPM …';
      if (!known?.key && q('#nowKey')) q('#nowKey').textContent = 'TOM …';
    }

    try {
      const result = await analyzer.analyze({ uri: track.nativeUri });
      const bpm = result?.bpm ? Math.round(Number(result.bpm)) : null;
      const key = result?.key ? String(result.key) : null;
      state.trackAnalysis[id] = {
        bpm,
        key,
        bpmConfidence: result?.bpmConfidence ?? null,
        keyConfidence: result?.keyConfidence ?? null,
        secondsAnalyzed: result?.secondsAnalyzed ?? null,
        engine: 'android-v21',
        analyzedAt: Date.now()
      };
      save();
      if (trackKey(currentTrack()) === id) {
        updateTrackAnalysisUI(track);
        syncPitchSelector();
      }
      if (!silent) toast(bpm && key ? `Análise: ${bpm} BPM · ${key}` : 'Análise concluída parcialmente');
      return !!(bpm || key);
    } catch (error) {
      console.warn('PULSAR: análise nativa falhou', error);
      if (trackKey(currentTrack()) === id) updateTrackAnalysisUI(track);
      if (!silent) toast('Não foi possível analisar BPM e tom desta faixa');
      return false;
    } finally {
      analysisJobs.delete(id);
      if (button && !silent) { button.disabled = false; button.textContent = oldText || 'Analisar'; }
    }
  }

  function scheduleAnalysis(track = currentTrack()) {
    if (!track?.nativeUri) return;
    const id = trackKey(track);
    const known = state.trackAnalysis?.[id];
    if (known?.engine === 'android-v21' && known?.bpm && known?.key) return;
    clearTimeout(scheduleAnalysis.timer);
    scheduleAnalysis.timer = setTimeout(() => {
      if (trackKey(currentTrack()) === id) analyzeNativeTrack(track, true, false);
    }, 1200);
  }

  function installAutomaticAnalysis() {
    const analyzeButton = q('#analyzeBtn');
    if (analyzeButton) analyzeButton.onclick = () => {
      const track = currentTrack();
      if (!track) return toast('Escolha uma música primeiro');
      if (track.nativeUri && analyzerPlugin()?.analyze) return analyzeNativeTrack(track, false, true);
      if (typeof analyzeCurrentTrack === 'function') return analyzeCurrentTrack();
    };

    const title = q('#nowTitle');
    if (title) new MutationObserver(() => {
      syncPitchSelector();
      scheduleAnalysis(currentTrack());
    }).observe(title, { childList: true, characterData: true, subtree: true });

    const key = q('#nowKey');
    if (key) new MutationObserver(syncPitchSelector).observe(key, { childList: true, characterData: true, subtree: true });

    scheduleAnalysis(currentTrack());
  }

  function init() {
    installPitchSelector();
    installAutomaticAnalysis();
    syncPitchSelector();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
