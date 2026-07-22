const queueNames = { revalidation: 'Revalidação de anúncios', images: 'Download de imagens', documents: 'Download de documentos' };
const statusNames = { pending: 'Pendente', processing: 'Processando', failed: 'Falha', exhausted: 'Esgotado', scheduled: 'Agendado', downloaded: 'Concluído' };

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('operations-refresh').addEventListener('click', loadAll);
  for (const id of ['queue-filter', 'status-filter', 'site-filter']) document.getElementById(id).addEventListener('change', () => void loadAll());
  document.addEventListener('click', (event) => {
    const card = event.target.closest('[data-queue]');
    if (card) { document.getElementById('queue-filter').value = card.dataset.queue; void loadAll(); }
    const retry = event.target.closest('[data-retry]');
    if (retry) void retryItem(retry);
  });
  void loadAll();
  setInterval(() => void loadAll(false), 15000);
});

async function loadAll(showLoading = true) {
  const site = document.getElementById('site-filter').value;
  const queue = document.getElementById('queue-filter').value;
  const status = document.getElementById('status-filter').value;
  if (showLoading) document.getElementById('operations-refresh').disabled = true;
  try {
    const query = site ? `?site=${encodeURIComponent(site)}` : '';
    const [queuesResponse, itemsResponse] = await Promise.all([
      fetch(`/api/operations/queues${query}`),
      fetch(`/api/operations/items?queue=${encodeURIComponent(queue)}&status=${encodeURIComponent(status)}&site=${encodeURIComponent(site)}&limit=150`),
    ]);
    if (!queuesResponse.ok || !itemsResponse.ok) throw new Error('Não foi possível consultar as filas.');
    const summary = await queuesResponse.json();
    const items = await itemsResponse.json();
    renderSites(summary.sites, site);
    renderQueues(summary.queues, queue);
    renderItems(items);
    document.getElementById('queue-title').textContent = queueNames[queue];
    document.getElementById('operations-updated').textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  } catch (error) {
    document.getElementById('operations-items').innerHTML = `<tr><td colspan="8" class="history-empty">${escapeHtml(error.message)}</td></tr>`;
  } finally { document.getElementById('operations-refresh').disabled = false; }
}

function renderSites(sites, selected) {
  const select = document.getElementById('site-filter');
  if (select.options.length > 1) return;
  select.innerHTML = '<option value="">Todos os sites</option>' + sites.map((site) => `<option value="${escapeAttr(site)}">${escapeHtml(siteLabel(site))}</option>`).join('');
  select.value = selected;
}

function renderQueues(queues, selected) {
  document.getElementById('queue-cards').innerHTML = queues.map((item) => {
    const pending = Number(item.pending || 0), processing = Number(item.processing || 0), failed = Number(item.failed || 0), exhausted = Number(item.exhausted || 0);
    const drainHours = Number(item.throughput1h) > 0 ? pending / Number(item.throughput1h) : null;
    const health = exhausted || failed ? 'failed' : pending ? 'warning' : 'success';
    return `<button type="button" class="queue-card ${item.queue === selected ? 'active' : ''}" data-queue="${escapeAttr(item.queue)}">
      <header><div><span>${health === 'success' ? 'Saudável' : health === 'failed' ? 'Atenção necessária' : 'Fila acumulada'}</span><h2>${escapeHtml(queueNames[item.queue])}</h2></div><i class="queue-health ${health}"></i></header>
      <div class="queue-volume"><strong>${number(pending)}</strong><span>aguardando</span></div>
      <dl><div><dt>Processando</dt><dd>${number(processing)}</dd></div><div><dt>Falhas</dt><dd>${number(failed)}</dd></div><div><dt>Esgotados</dt><dd>${number(exhausted)}</dd></div><div><dt>Mais antigo</dt><dd>${ageFrom(item.oldestAt)}</dd></div></dl>
      <footer><span>Cycle P95 <strong>${duration(item.cycleP95Seconds)}</strong></span><span>Lead P95 <strong>${duration(item.leadP95Seconds)}</strong></span><span>Vazão <strong>${number(item.throughput1h)}/h</strong></span><span>Previsão <strong>${drainHours == null ? '—' : duration(drainHours * 3600)}</strong></span></footer>
    </button>`;
  }).join('');
}

function renderItems(items) {
  document.getElementById('operations-items').innerHTML = items.length ? items.map((item) => `<tr>
    <td><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener"><strong>${escapeHtml(item.title || item.url)}</strong><small>${escapeHtml(siteLabel(item.site))} · ${escapeHtml(item.queue)}</small></a></td>
    <td><span class="queue-status ${escapeAttr(item.status)}">${escapeHtml(statusNames[item.status] || item.status)}</span></td>
    <td><strong>${age(item.ageSeconds)}</strong><small>${dateTime(item.queuedAt)}</small></td>
    <td>${number(item.attempts)}</td><td>${duration(item.cycleSeconds)}</td><td>${duration(item.leadSeconds)}</td>
    <td class="operation-error" title="${escapeAttr(item.lastError || '')}">${escapeHtml(item.lastError || '—')}</td>
    <td>${['failed','exhausted'].includes(item.status) ? `<button class="retry-button" type="button" data-retry data-queue-name="${escapeAttr(item.queue)}" data-id="${item.id}">Tentar novamente</button>` : ''}</td>
  </tr>`).join('') : '<tr><td colspan="8" class="history-empty">Nenhum item nesta situação.</td></tr>';
}

async function retryItem(button) {
  button.disabled = true;
  const response = await fetch(`/api/operations/retry/${encodeURIComponent(button.dataset.queueName)}/${button.dataset.id}`, { method: 'POST' });
  if (!response.ok) window.alert('Não foi possível reagendar este item.');
  await loadAll(false);
}

function number(value) { return new Intl.NumberFormat('pt-BR').format(Number(value || 0)); }
function duration(value) { const seconds = Number(value); if (!Number.isFinite(seconds) || seconds < 0) return '—'; if (seconds < 60) return `${Math.round(seconds)}s`; if (seconds < 3600) return `${Math.round(seconds / 60)}min`; if (seconds < 86400) return `${(seconds / 3600).toFixed(seconds < 36000 ? 1 : 0)}h`; return `${(seconds / 86400).toFixed(1)}d`; }
function age(value) { return duration(value); }
function ageFrom(value) { return value ? duration((Date.now() - new Date(value).getTime()) / 1000) : '—'; }
function dateTime(value) { return value ? new Date(value).toLocaleString('pt-BR') : '—'; }
function siteLabel(site) { return ({ leilo:'Leilo',vipleiloes:'VIP Leilões',superbid:'Superbid',francoleiloes:'Franco Leilões',alessandroteixeira:'Alessandro Teixeira',alvaroleiloes:'Álvaro Leilões',brunoleiloes:'Bruno Leilões',calilleiloes:'Calil Leilões',capitalvalorleiloes:'Capital Valor',d1lance:'D1 Lance',carloferrarileiloes:'Carlo Ferrari',dasilvaleiloes:'Da Silva',cidafixerleiloes:'Cida Fixer',doleiloes:'Dó Leilões' })[site] || site || ''; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]); }
function escapeAttr(value) { return escapeHtml(value); }
