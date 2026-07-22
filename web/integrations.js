let collectionRunning = false;

document.addEventListener('DOMContentLoaded', () => {
  void loadIntegrations().then(refreshCollectionProgress);
  setInterval(() => void refreshCollectionProgress(), 2000);
});

async function loadIntegrations() {
  try {
    const response = await fetch('/api/integrations');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const integrations = await response.json();
    renderGroup('vehicles', integrations.filter((item) => item.catalog === 'vehicles'));
    renderGroup('real-estate', integrations.filter((item) => item.catalog === 'real_estate'));
    const totalLots = integrations.reduce((sum, item) => sum + Number(item.lotCount || 0), 0);
    document.getElementById('integration-totals').innerHTML = `<div><strong>${integrations.length}</strong><span>origens integradas</span></div><div><strong>${formatNumber(totalLots)}</strong><span>anúncios catalogados</span></div>`;
  } catch (error) {
    document.querySelectorAll('.integration-grid').forEach((element) => { element.innerHTML = `<p class="request-error">Não foi possível carregar as integrações. ${escapeHtml(error.message)}</p>`; });
  }
}

function renderGroup(id, integrations) {
  document.getElementById(`${id}-count`).textContent = `${integrations.length} ${integrations.length === 1 ? 'origem' : 'origens'}`;
  document.getElementById(`${id}-integrations-list`).innerHTML = integrations.map(integrationCard).join('');
}

function integrationCard(item) {
  const status = integrationStatus(item);
  const collectionLink = item.collectionUrl !== item.publicUrl
    ? `<a href="${escapeAttr(item.collectionUrl)}" target="_blank" rel="noopener"><span>Endpoint de coleta</span><strong>${escapeHtml(host(item.collectionUrl))}</strong></a>` : '';
  return `<article class="integration-card"><header><div><span>${escapeHtml(item.scopes.join(' · '))}</span><h3>${escapeHtml(item.name)}</h3></div><span class="integration-status ${status.className}"><i></i>${status.label}</span></header>
    <dl><div><dt>Anúncios</dt><dd>${formatNumber(item.lotCount)}</dd></div><div><dt>Em aberto</dt><dd>${formatNumber(item.activeLots)}</dd></div><div><dt>Eventos</dt><dd>${formatNumber(item.eventCount)}</dd></div></dl>
    <div class="integration-links"><a href="${escapeAttr(item.publicUrl)}" target="_blank" rel="noopener"><span>URL pública integrada</span><strong>${escapeHtml(item.publicUrl)}</strong></a>${collectionLink}</div>
    <footer><div><span>Último dado: ${relativeTime(item.lastSeenAt)}</span><span>Última coleta: ${relativeTime(item.lastRunFinishedAt || item.lastRunStartedAt)}</span></div><button class="integration-collect-button" type="button" data-collect-site="${escapeAttr(item.site)}">Atualizar este site</button></footer></article>`;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-collect-site]');
  if (button) void startSiteCollection(button.dataset.collectSite);
});

async function startSiteCollection(site) {
  const button = document.querySelector(`[data-collect-site="${CSS.escape(site)}"]`);
  if (button) { button.disabled = true; button.textContent = 'Iniciando...'; }
  try {
    const response = await fetch(`/api/collection/${encodeURIComponent(site)}`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    await refreshCollectionProgress();
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = 'Atualizar este site'; }
    window.alert(error.message);
  }
}

async function refreshCollectionProgress() {
  try {
    const response = await fetch('/api/collection');
    if (!response.ok) return;
    const progress = await response.json();
    const wasRunning = collectionRunning;
    collectionRunning = Boolean(progress.running);
    const strip = document.getElementById('integration-collection-strip');
    strip.hidden = !collectionRunning && !progress.lastError;
    if (collectionRunning) {
      const currentSite = progress.currentSite || progress.site;
      const current = document.querySelector(`[data-collect-site="${CSS.escape(currentSite || '')}"]`)?.closest('.integration-card')?.querySelector('h3')?.textContent || currentSite || 'catálogos';
      document.getElementById('integration-collection-title').textContent = `Atualizando ${current}`;
      document.getElementById('integration-collection-detail').textContent = `${progress.processedPages}/${progress.totalPages || '?'} páginas · ${progress.new} novos · ${progress.updated} atualizados · ${progress.unchanged} sem alteração`;
      document.getElementById('integration-collection-progress').style.width = `${progress.totalPages ? Math.round(progress.processedPages / progress.totalPages * 100) : 2}%`;
    } else if (progress.lastError) {
      document.getElementById('integration-collection-title').textContent = 'Falha na última coleta';
      document.getElementById('integration-collection-detail').textContent = progress.lastError;
      document.getElementById('integration-collection-progress').style.width = '100%';
    }
    document.querySelectorAll('[data-collect-site]').forEach((button) => {
      const active = collectionRunning && button.dataset.collectSite === (progress.currentSite || progress.site);
      button.disabled = collectionRunning;
      button.textContent = active ? `Atualizando ${progress.processedPages}/${progress.totalPages || '?'} páginas...` : 'Atualizar este site';
    });
    if (wasRunning && !collectionRunning) await loadIntegrations();
  } catch {}
}

function integrationStatus(item) {
  if (item.lastRunStatus === 'failed') return { className: 'failed', label: 'Falha recente' };
  if (item.lastRunStatus === 'partial' || Number(item.failedCount) > 0) return { className: 'warning', label: 'Atenção' };
  if (Number(item.lotCount) > 0) return { className: 'success', label: 'Integrada' };
  return { className: 'neutral', label: 'Sem dados' };
}

function relativeTime(value) {
  if (!value) return 'não disponível';
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)} h`;
  return `há ${Math.floor(diff / 86_400_000)} dias`;
}

function host(value) { try { return new URL(value).hostname; } catch { return value; } }
function formatNumber(value) { return new Intl.NumberFormat('pt-BR').format(Number(value || 0)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function escapeAttr(value) { return escapeHtml(value); }
