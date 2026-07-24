const siteNames = { leilo:'Leilo',vipleiloes:'VIP Leilões',superbid:'Superbid',francoleiloes:'Franco Leilões',alessandroteixeira:'Alessandro Teixeira',alvaroleiloes:'Álvaro Leilões',brunoleiloes:'Bruno Leilões',calilleiloes:'Calil Leilões',capitalvalorleiloes:'Capital Valor',d1lance:'D1 Lance',carloferrarileiloes:'Carlo Ferrari',dasilvaleiloes:'Da Silva',cidafixerleiloes:'Cida Fixer',doleiloes:'Dó Leilões' };

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('storage-refresh').addEventListener('click', () => void loadStorage());
  document.getElementById('storage-days').addEventListener('change', () => void loadStorage());
  document.getElementById('storage-site').addEventListener('change', () => void loadStorage());
  void loadStorage();
});

async function loadStorage() {
  const button = document.getElementById('storage-refresh');
  const days = document.getElementById('storage-days').value;
  const site = document.getElementById('storage-site').value;
  button.disabled = true;
  try {
    const [usageResponse, statsResponse] = await Promise.all([
      fetch(`/api/storage/usage?days=${encodeURIComponent(days)}&site=${encodeURIComponent(site)}`),
      fetch(`/api/storage/stats?site=${encodeURIComponent(site)}`),
    ]);
    if (!usageResponse.ok || !statsResponse.ok) throw new Error('Não foi possível consultar as métricas.');
    const usage = await usageResponse.json();
    const stats = await statsResponse.json();
    populateSites(usage.bySite, site);
    renderStorage(usage, stats);
  } catch (error) {
    document.getElementById('storage-notice').textContent = error.message;
    document.getElementById('storage-notice').classList.add('error');
  } finally { button.disabled = false; }
}

function renderStorage(usage, stats) {
  const requests = totals(usage.summary);
  const inventory = (stats.objects || []).reduce((acc, item) => {
    acc.objects += Number(item.objectCount || 0);
    acc.bytes += Number(item.sizeBytes || 0);
    return acc;
  }, { objects: 0, bytes: 0 });
  const observedSince = usage.period?.observedSince ? new Date(usage.period.observedSince) : null;
  const observedHours = observedSince ? Math.max(1, Math.min(Number(usage.days) * 24, (Date.now() - observedSince.getTime()) / 3600000)) : 0;
  const factor = observedHours ? 720 / observedHours : 0;
  const project = (value) => Math.round(value * factor);
  const projected = {
    puts: project(requests.puts), tier2: project(requests.gets + requests.heads),
    bytesIn: project(requests.bytesIn), bytesOut: project(requests.bytesOut),
  };
  const confidence = observedHours >= 720 ? 'alta' : observedHours >= 168 ? 'média' : 'preliminar';
  document.getElementById('storage-period').textContent = observedHours
    ? `Base: ${duration(observedHours * 3600)} · confiança ${confidence}` : 'Aguardando primeiras operações';
  document.getElementById('storage-kpis').innerHTML = [
    kpi('Estoque atual', fileSize(inventory.bytes), `${number(inventory.objects)} objetos`),
    kpi('PUT observados', number(requests.puts), fileSize(requests.bytesIn)),
    kpi('GET observados', number(requests.gets), fileSize(requests.bytesOut)),
    kpi('HEAD observados', number(requests.heads), `${number(requests.headHits)} encontrados`),
    kpi('Falhas', number(requests.failures), `${percent(requests.failures, requests.total)} das chamadas`),
    kpi('Deduplicação', percent(requests.headHits, requests.heads), 'HEAD sem novo PUT'),
  ].join('');
  document.getElementById('calculator-inputs').innerHTML = [
    calculator('S3 Standard', decimal(inventory.bytes / 1e9), 'GB armazenados'),
    calculator('PUT, COPY, POST, LIST', number(projected.puts), 'solicitações/mês'),
    calculator('GET, SELECT e outras', number(projected.tier2), 'solicitações/mês'),
    calculator('Transferência de saída', decimal(projected.bytesOut / 1e9), 'GB/mês'),
    calculator('Novos dados', decimal(projected.bytesIn / 1e9), 'GB/mês'),
    calculator('S3 Select', '0', 'GB/mês'),
  ].join('');
  renderDaily(usage.daily || []);
  renderBySite(usage.bySite || []);
  document.getElementById('storage-notice').textContent = observedHours
    ? `Medição iniciada em ${observedSince.toLocaleString('pt-BR')}. Projeções normalizadas para 720 horas.`
    : 'A medição está ativa e aparecerá após a primeira operação de armazenamento.';
}

function totals(rows) {
  const result = { puts:0, gets:0, heads:0, headHits:0, failures:0, bytesIn:0, bytesOut:0, total:0 };
  for (const row of rows) {
    const count = Number(row.requestCount || 0);
    result.total += count;
    if (!row.success && row.operation !== 'head') result.failures += count;
    if (row.operation === 'put') result.puts += count;
    if (row.operation === 'get') result.gets += count;
    if (row.operation === 'head') {
      result.heads += count;
      if (row.success) result.headHits += count;
    }
    result.bytesIn += Number(row.bytesIn || 0);
    result.bytesOut += Number(row.bytesOut || 0);
  }
  return result;
}

function renderDaily(rows) {
  document.getElementById('storage-daily').innerHTML = rows.length ? rows.map((row) => `<tr>
    <td><strong>${new Date(`${row.day}T12:00:00`).toLocaleDateString('pt-BR')}</strong></td>
    <td>${number(row.puts)}</td><td>${number(row.gets)}</td><td>${number(row.heads)}</td>
    <td>${number(row.failures)}</td><td>${fileSize(row.bytesIn)}</td><td>${fileSize(row.bytesOut)}</td>
  </tr>`).join('') : emptyRow(7);
}

function renderBySite(rows) {
  document.getElementById('storage-sites').innerHTML = rows.length ? rows.map((row) => `<tr>
    <td><strong>${escapeHtml(siteLabel(row.site))}</strong></td><td>${number(row.puts)}</td>
    <td>${number(row.tier2Requests)}</td><td>${fileSize(row.bytesIn)}</td><td>${fileSize(row.bytesOut)}</td>
  </tr>`).join('') : emptyRow(5);
}

function populateSites(rows, selected) {
  const select = document.getElementById('storage-site');
  if (select.options.length > 1) return;
  select.innerHTML = '<option value="">Todos os sites</option>' + rows.map((row) =>
    `<option value="${escapeHtml(row.site)}">${escapeHtml(siteLabel(row.site))}</option>`).join('');
  select.value = selected;
}

function kpi(label, value, detail) { return `<article><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`; }
function calculator(label, value, unit) { return `<article><span>${label}</span><strong>${value}</strong><small>${unit}</small></article>`; }
function emptyRow(columns) { return `<tr><td colspan="${columns}" class="history-empty">Ainda não há dados neste período.</td></tr>`; }
function siteLabel(site) { return siteNames[site] || site || 'Desconhecido'; }
function number(value) { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(value || 0)); }
function decimal(value) { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value || 0)); }
function percent(value, total) { return total ? `${decimal(Number(value) * 100 / Number(total))}%` : '0%'; }
function fileSize(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1e9) return `${decimal(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${decimal(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${decimal(bytes / 1e3)} KB`;
  return `${number(bytes)} B`;
}
function duration(seconds) { if (seconds < 86400) return `${decimal(seconds / 3600)}h`; return `${decimal(seconds / 86400)} dias`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]); }
