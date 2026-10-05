/* PULSAR 2.8 — sincronização automática com a Ponte da igreja.
   Baixa PAD e DRUM PAD diretamente do PC da Ponte e deixa tudo offline. */
(() => {
  'use strict';

  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const native = () => !!window.Capacitor?.isNativePlatform?.();
  const audioPlugin = () => window.Capacitor?.Plugins?.PulsarDriveAudio;
  const BRIDGE_URL_KEY = 'pulsar-ponte-url-v28';
  const BRIDGE_CODE_KEY = 'pulsar-ponte-code-v28';
  const ONBOARDING_KEY = 'nexo-onboarding-v17';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const displayBank = bank => bank?.displayName || bank?.name || 'Ponte';
  const fileLabel = file => String(file?.name || 'Áudio').replace(/\.[^.]+$/, '');
  const fmtBytes = value => {
    let n = Number(value || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  state.bridgeOfflineAssets ??= {};
  state.bridgeSync ??= { lastSync: 0, lastBridge: '' };

  function normalizeBridgeUrl(value) {
    const raw = String(value || '').trim().replace(/\/+$/, '');
    if (!raw) throw new Error('Digite o endereço da Ponte.');
    let url;
    try { url = new URL(raw); } catch { throw new Error('Endereço da Ponte inválido.'); }
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      throw new Error('A Ponte precisa usar um endereço HTTPS.');
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  }

  function normalizeCode(value) {
    const code = String(value || '').toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 12);
    if (code.length !== 12) throw new Error('Digite o código de 12 caracteres mostrado na Ponte.');
    return code;
  }

  function ensureStyle() {
    if (q('#pulsarBridgeStyle')) return;
    const style = document.createElement('style');
    style.id = 'pulsarBridgeStyle';
    style.textContent = `
      #pulsarBridgeDialog{border:0;padding:0;background:transparent;color:#fff;max-width:none;width:min(94vw,560px)}
      #pulsarBridgeDialog::backdrop{background:rgba(0,0,0,.72);backdrop-filter:blur(10px)}
      .bridge-shell{background:linear-gradient(160deg,#0f1724,#09111b);border:1px solid #23354a;border-radius:24px;box-shadow:0 26px 80px rgba(0,0,0,.55);overflow:hidden}
      .bridge-head{display:flex;gap:12px;align-items:flex-start;padding:20px;border-bottom:1px solid #1d2a3a}.bridge-head>div{flex:1}.bridge-head small{font-size:10px;letter-spacing:.16em;color:#65d7ff}.bridge-head h2{margin:5px 0 6px;font-size:22px}.bridge-head p{margin:0;color:#96a7b9;font-size:13px;line-height:1.45}.bridge-head button{width:40px;height:40px;border-radius:12px;border:1px solid #26384b;background:#111d2a;color:#fff;font-size:22px}
      .bridge-body{display:grid;gap:14px;padding:18px 20px}.bridge-body label{display:grid;gap:7px}.bridge-body label span{font-size:10px;letter-spacing:.12em;color:#7f93a8}.bridge-body input{min-height:48px;border:1px solid #2a3c50;border-radius:13px;background:#0b141f;color:#fff;padding:0 13px;font:inherit}.bridge-body input:focus{outline:2px solid rgba(48,197,255,.28);border-color:#43c8f5}
      .bridge-hint{margin:0;padding:11px 12px;border-radius:12px;background:#0b1b24;color:#9ab4c6;font-size:12px;line-height:1.45}.bridge-hint b{color:#d9f4ff}
      .bridge-progress{display:grid;gap:7px}.bridge-progress[hidden]{display:none}.bridge-progress div{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:#c9d7e5}.bridge-progress span{display:block;height:8px;background:#172536;border-radius:999px;overflow:hidden}.bridge-progress i{display:block;width:0;height:100%;background:linear-gradient(90deg,#2bc5f4,#8c6fff);border-radius:inherit;transition:width .18s ease}
      .bridge-actions{display:flex;gap:10px;padding:0 20px 20px}.bridge-actions button{min-height:46px;border-radius:13px;border:1px solid #2c4055;background:#111d2a;color:#dce8f4;padding:0 16px;font-weight:700}.bridge-actions .primary{flex:1;background:linear-gradient(135deg,#29bce9,#6f5df2);border:0;color:#fff}
      .pulsar-bridge-card{margin:16px 0;padding:16px;border:1px solid #244158;border-radius:18px;background:linear-gradient(145deg,#0d1a24,#0a131d)}.pulsar-bridge-card small{display:block;color:#6fcff2;font-size:10px;letter-spacing:.14em}.pulsar-bridge-card h3{margin:5px 0 6px}.pulsar-bridge-card p{margin:0 0 12px;color:#95a7b9;font-size:12px;line-height:1.4}.pulsar-bridge-card button{width:100%;min-height:46px;border:0;border-radius:13px;background:linear-gradient(135deg,#20b9e8,#725df2);color:#fff;font-weight:800}
    `;
    document.head.appendChild(style);
  }

  function ensureDialog() {
    ensureStyle();
    let dlg = q('#pulsarBridgeDialog');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'pulsarBridgeDialog';
    dlg.innerHTML = `
      <div class="bridge-shell">
        <header class="bridge-head">
          <div><small>PULSAR · PONTE DA IGREJA</small><h2>Sincronizar biblioteca</h2><p>Baixe automaticamente todos os bancos de PAD e DRUM PAD da Ponte para este aparelho.</p></div>
          <button id="bridgeClose" type="button" aria-label="Fechar">×</button>
        </header>
        <div class="bridge-body">
          <label><span>ENDEREÇO DA PONTE</span><input id="bridgeUrl" inputmode="url" autocomplete="off" placeholder="https://audio.seudominio.com"></label>
          <label><span>CÓDIGO DA PONTE</span><input id="bridgeCode" autocomplete="off" autocapitalize="characters" maxlength="12" placeholder="A1B2C3D4E5F6"></label>
          <p class="bridge-hint"><b>No PC da igreja:</b> abra a Ponte. Ela mostrará o endereço e o código PULSAR. O código só precisa ser informado na primeira sincronização.</p>
          <div id="bridgeProgress" class="bridge-progress" hidden>
            <div><b id="bridgeProgressText">Preparando…</b><span id="bridgeProgressMeta"></span></div>
            <span><i id="bridgeProgressBar"></i></span>
          </div>
        </div>
        <footer class="bridge-actions">
          <button id="bridgeCancel" type="button">AGORA NÃO</button>
          <button id="bridgeSync" class="primary" type="button">SINCRONIZAR TUDO</button>
        </footer>
      </div>`;
    document.body.appendChild(dlg);

    const close = () => { if (dlg.open) dlg.close(); };
    q('#bridgeClose').onclick = close;
    q('#bridgeCancel').onclick = close;
    dlg.addEventListener('cancel', event => { event.preventDefault(); close(); });
    q('#bridgeCode').addEventListener('input', e => {
      e.target.value = String(e.target.value || '').toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 12);
    });
    q('#bridgeSync').onclick = () => syncFromBridge();
    return dlg;
  }

  function setProgress(text, current = 0, total = 0, bytes = 0) {
    const wrap = q('#bridgeProgress');
    if (!wrap) return;
    wrap.hidden = false;
    q('#bridgeProgressText').textContent = text;
    q('#bridgeProgressMeta').textContent = total ? `${current}/${total}${bytes ? ` · ${fmtBytes(bytes)}` : ''}` : (bytes ? fmtBytes(bytes) : '');
    q('#bridgeProgressBar').style.width = total ? `${Math.max(2, Math.min(100, Math.round(current / total * 100)))}%` : '4%';
  }

  function openBridgeDialog() {
    if (!native() || !audioPlugin()?.cacheUrl) return toast('A sincronização com a Ponte funciona no APK Android atualizado.');
    const dlg = ensureDialog();
    const first = q('#syncFirstRun');
    if (first?.open) first.close();
    q('#bridgeUrl').value = localStorage.getItem(BRIDGE_URL_KEY) || '';
    q('#bridgeCode').value = localStorage.getItem(BRIDGE_CODE_KEY) || '';
    q('#bridgeProgress').hidden = true;
    q('#bridgeProgressBar').style.width = '0%';
    if (!dlg.open) dlg.showModal();
    setTimeout(() => (q('#bridgeUrl').value ? q('#bridgeCode') : q('#bridgeUrl'))?.focus?.(), 80);
  }

  async function fetchCatalog(baseUrl, code) {
    const response = await fetch(`${baseUrl}/pulsar/catalogo?code=${encodeURIComponent(code)}&ts=${Date.now()}`, {
      cache: 'no-store'
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data?.erro || `A Ponte respondeu ${response.status}.`);
    if (!data?.ok) throw new Error('A Ponte não retornou um catálogo válido.');
    return data;
  }

  function flattenCatalog(catalog) {
    const rows = [];
    for (const bank of catalog.padBanks || []) {
      for (const file of bank.files || []) rows.push({ kind: 'Pads', bank, file });
    }
    for (const bank of catalog.drumBanks || []) {
      for (const file of bank.files || []) rows.push({ kind: 'Drums', bank, file });
    }
    return rows;
  }

  function noteForFile(file, fallbackIndex) {
    try {
      if (typeof noteFromFilename === 'function') {
        const found = noteFromFilename(file?.name || file?.relativePath || '');
        if (found) return found;
      }
    } catch {}
    return tonalNotes?.[fallbackIndex % 12]?.key || null;
  }

  function applyPads(padBanks) {
    const activeBankKeys = new Set();
    const activeAssetIds = new Set();

    for (const sourceBank of padBanks || []) {
      const bankName = displayBank(sourceBank);
      const bankKey = norm(bankName);
      activeBankKeys.add(bankKey);

      let bank = (state.ambientBanks || []).find(b => b.bridgeManaged && norm(b.name) === bankKey);
      if (!bank) {
        bank = { id:`bridge-pad-bank-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, name:bankName, slots:{}, bridgeManaged:true };
        state.ambientBanks.push(bank);
      }
      bank.name = bankName;
      bank.bridgeManaged = true;
      bank.bridgeCloud = false;
      bank.bridgeFileCount = (sourceBank.files || []).length;
      bank.slots = {};

      const used = new Set();
      const remaining = [];
      (sourceBank.files || []).forEach((file, index) => {
        let asset = (state.ambientLibrary || []).find(a => a.bridgeSourceId === file.sourceId);
        if (!asset) {
          asset = { id:`bridge-pad-${file.sourceId}` };
          state.ambientLibrary.push(asset);
        }
        asset.id ||= `bridge-pad-${file.sourceId}`;
        asset.name = fileLabel(file);
        asset.fileName = file.name || 'Áudio';
        asset.bridgeSourceId = file.sourceId;
        asset.bridgeBankName = bankName;
        asset.bridgeManaged = true;
        asset.nativeFileUri = file.localUri;
        asset.size = Number(file.size || 0);
        asset.modified = file.modified || '';
        activeAssetIds.add(asset.id);

        const note = noteForFile(file, index);
        if (note && !used.has(note)) {
          bank.slots[note] = asset.id;
          used.add(note);
        } else {
          remaining.push(asset);
        }
      });

      for (const note of tonalNotes || []) {
        if (bank.slots[note.key]) continue;
        const asset = remaining.shift();
        if (!asset) break;
        bank.slots[note.key] = asset.id;
      }
    }

    state.ambientBanks = (state.ambientBanks || []).filter(b => !b.bridgeManaged || activeBankKeys.has(norm(b.name)));
    state.ambientLibrary = (state.ambientLibrary || []).filter(a => !a.bridgeManaged || activeAssetIds.has(a.id));
    try { rebuildAmbientAssetIndex(); } catch {}
  }

  function applyDrums(drumBanks) {
    const activeBankKeys = new Set();

    for (const sourceBank of drumBanks || []) {
      const bankName = displayBank(sourceBank);
      const bankKey = norm(bankName);
      activeBankKeys.add(bankKey);

      let bank = (state.drumBanks || []).find(b => b.bridgeManaged && norm(b.name) === bankKey);
      if (!bank) {
        bank = { id:`bridge-drum-bank-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, name:bankName, pads:[], bridgeManaged:true };
        state.drumBanks.push(bank);
      }

      const old = new Map((bank.pads || []).filter(p => p.bridgeSourceId).map(p => [p.bridgeSourceId, p]));
      bank.name = bankName;
      bank.bridgeManaged = true;
      bank.bridgeCloud = false;
      bank.bridgeFileCount = (sourceBank.files || []).length;
      bank.pads = (sourceBank.files || []).map((file, index) => {
        const previous = old.get(file.sourceId) || {};
        return {
          ...previous,
          name: previous.name || fileLabel(file),
          fileName: file.name || 'Áudio',
          bridgeSourceId: file.sourceId,
          bridgeBankName: bankName,
          bridgeManaged: true,
          nativeFileUri: file.localUri,
          color: previous.color || padColors[index % padColors.length],
          volume: previous.volume ?? 1,
          repeat: previous.repeat ?? false,
          repeatBeats: previous.repeatBeats ?? 1
        };
      });

      if (bank.id === state.activeDrumBankId && !editingPads) {
        state.pads = JSON.parse(JSON.stringify(bank.pads || []));
      }
    }

    state.drumBanks = (state.drumBanks || []).filter(b => !b.bridgeManaged || activeBankKeys.has(norm(b.name)));
    if (!state.drumBanks.some(b => b.id === state.activeDrumBankId)) {
      state.activeDrumBankId = state.drumBanks[0]?.id || null;
      const active = state.drumBanks.find(b => b.id === state.activeDrumBankId);
      if (active) state.pads = JSON.parse(JSON.stringify(active.pads || []));
    }
  }

  function applyBridgeCatalog(catalog) {
    applyPads(catalog.padBanks || []);
    applyDrums(catalog.drumBanks || []);
    state.bridgeSync.lastSync = Date.now();
    state.bridgeSync.lastBridge = catalog.ponte || 'Ponte';
    save();
    try { renderDrums(); } catch {}
    try { renderAmbientLive(); } catch {}
  }

  async function syncFromBridge(options = {}) {
    if (!native() || !audioPlugin()?.cacheUrl) throw new Error('APK atualizado necessário.');
    const silent = !!options.silent;
    const urlInput = silent ? localStorage.getItem(BRIDGE_URL_KEY) : q('#bridgeUrl')?.value;
    const codeInput = silent ? localStorage.getItem(BRIDGE_CODE_KEY) : q('#bridgeCode')?.value;
    if (!urlInput || !codeInput) {
      if (silent) return;
      throw new Error('Informe o endereço e o código da Ponte.');
    }

    let baseUrl, code;
    try {
      baseUrl = normalizeBridgeUrl(urlInput);
      code = normalizeCode(codeInput);
    } catch (error) {
      if (!silent) toast(error.message);
      throw error;
    }

    const button = q('#bridgeSync');
    const oldText = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'SINCRONIZANDO...'; }
    if (!silent) setProgress('Conectando à Ponte…');

    try {
      const catalog = await fetchCatalog(baseUrl, code);
      const rows = flattenCatalog(catalog);
      if (!rows.length) throw new Error('A Ponte está online, mas não encontrou arquivos nas pastas PAD e DRUM PAD.');

      let done = 0;
      let bytes = 0;
      for (const row of rows) {
        const file = row.file;
        const previous = state.bridgeOfflineAssets[file.sourceId];
        let localUri = previous?.fileUri || '';
        const same = localUri && Number(previous?.size || 0) === Number(file.size || 0) &&
          String(previous?.modified || '') === String(file.modified || '');

        if (!same) {
          if (!silent) setProgress(`Baixando ${file.name || 'áudio'}…`, done, rows.length, bytes);
          const result = await audioPlugin().cacheUrl({
            url: `${baseUrl}${file.path}?code=${encodeURIComponent(code)}`,
            sourceId: file.sourceId,
            name: file.name,
            kind: row.kind === 'Pads' ? 'pads' : 'drums',
            bankName: displayBank(row.bank),
            size: Number(file.size || 0)
          });
          localUri = result.fileUri;
          state.bridgeOfflineAssets[file.sourceId] = {
            fileUri: localUri,
            size: Number(file.size || result.bytes || 0),
            modified: file.modified || '',
            kind: row.kind,
            bankName: displayBank(row.bank),
            cachedAt: Date.now()
          };
        }

        file.localUri = localUri;
        done += 1;
        bytes += Number(file.size || 0);
        if (!silent) setProgress(`Sincronizando ${displayBank(row.bank)}…`, done, rows.length, bytes);
      }

      applyBridgeCatalog(catalog);
      localStorage.setItem(BRIDGE_URL_KEY, baseUrl);
      localStorage.setItem(BRIDGE_CODE_KEY, code);
      localStorage.setItem(ONBOARDING_KEY, '1');

      if (!silent) {
        setProgress('Sincronização concluída', rows.length, rows.length, bytes);
        toast(`${rows.length} arquivo${rows.length === 1 ? '' : 's'} da Ponte disponível${rows.length === 1 ? '' : 'is'} offline`);
        setTimeout(() => q('#pulsarBridgeDialog')?.close(), 700);
      }
      return { total: rows.length, bytes };
    } catch (error) {
      console.error('PULSAR Ponte:', error);
      if (!silent) {
        setProgress(error.message || 'Falha na sincronização');
        toast(error.message || 'Não foi possível sincronizar com a Ponte');
      }
      throw error;
    } finally {
      if (button) { button.disabled = false; button.textContent = oldText || 'SINCRONIZAR TUDO'; }
    }
  }

  function installPermanentButton() {
    if (q('#openPulsarBridge')) return;
    const target = q('#syncDialog .sync-primary-actions') || q('#syncDialog .sync-backup-row');
    if (!target) return;
    const card = document.createElement('section');
    card.className = 'pulsar-bridge-card';
    card.innerHTML = `<small>PONTE DA IGREJA</small><h3>PAD + DRUM PAD automático</h3><p>Receba os bancos direto do PC da igreja e deixe os arquivos prontos para tocar offline.</p><button id="openPulsarBridge" type="button">⇄ SINCRONIZAR COM A PONTE</button>`;
    target.parentNode.insertBefore(card, target);
    q('#openPulsarBridge').onclick = openBridgeDialog;
  }

  function installFirstRun() {
    const first = q('#syncFirstRun');
    const button = q('#firstRunDrive');
    if (first) {
      const p = first.querySelector('.first-run-card p');
      if (p) p.textContent = 'Em um aparelho novo, sincronize com a Ponte da igreja para receber automaticamente os PADs e Drum Pads. Você também pode copiar de outro PULSAR.';
    }
    if (button) {
      button.textContent = '⇄ SINCRONIZAR COM A PONTE';
      button.onclick = () => {
        if (first?.open) first.close();
        openBridgeDialog();
      };
    }

    if (native() && !localStorage.getItem(ONBOARDING_KEY)) {
      setTimeout(() => {
        if (!localStorage.getItem(ONBOARDING_KEY) && first && !first.open && !q('#pulsarBridgeDialog')?.open) {
          first.showModal();
        }
      }, 850);
    }
  }

  function autoRefresh() {
    const url = localStorage.getItem(BRIDGE_URL_KEY);
    const code = localStorage.getItem(BRIDGE_CODE_KEY);
    const last = Number(state.bridgeSync?.lastSync || 0);
    if (!native() || !url || !code || Date.now() - last < 6 * 60 * 60 * 1000) return;
    setTimeout(() => syncFromBridge({ silent:true }).catch(() => {}), 3500);
  }

  function init() {
    ensureDialog();
    installPermanentButton();
    installFirstRun();
    autoRefresh();
    window.PulsarPonte = { abrir: openBridgeDialog, sincronizar: syncFromBridge };
  }

  setTimeout(init, 0);
})();
