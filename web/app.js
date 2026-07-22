const facetConfig = [
  { key: 'site', param: 'site', label: 'Origem', open: true },
  { key: 'propertyType', param: 'propertyType', label: 'Tipo de imóvel', open: true, searchable: true, catalog: 'real_estate' },
  { key: 'brand', param: 'brand', label: 'Marca', open: true, searchable: true, catalog: 'vehicles' },
  { key: 'model', param: 'model', label: 'Modelo', open: true, searchable: true, catalog: 'vehicles' },
  { key: 'year', param: 'year', label: 'Ano', open: true, catalog: 'vehicles' },
  { key: 'vehicleCondition', param: 'vehicleCondition', label: 'Condição do veículo', open: true, catalog: 'vehicles' },
  { key: 'status', param: 'status', label: 'Status', open: true },
  { key: 'state', param: 'state', label: 'Estado' },
  { key: 'city', param: 'city', label: 'Cidade', searchable: true },
  { key: 'neighborhood', param: 'neighborhood', label: 'Bairro', searchable: true, catalog: 'real_estate' },
  { key: 'origin', param: 'origin', label: 'Procedência', searchable: true, catalog: 'vehicles' },
  { key: 'consignor', param: 'consignor', label: 'Comitente', searchable: true },
  { key: 'classification', param: 'classification', label: 'Classificação', searchable: true },
  { key: 'fuel', param: 'fuel', label: 'Combustível', searchable: true, catalog: 'vehicles' },
  { key: 'transmission', param: 'transmission', label: 'Câmbio', searchable: true, catalog: 'vehicles' },
  { key: 'runningAtEntry', param: 'runningAtEntry', label: 'Funcionando na entrada', catalog: 'vehicles' },
  { key: 'event', param: 'event', label: 'Evento', searchable: true },
];

const state = {
  page: 1,
  pageSize: 24,
  total: 0,
  catalog: 'vehicles',
  search: '',
  eventDateFrom: '',
  eventDateTo: '',
  endingWindowDays: 0,
  view: 'grid',
  sort: 'auction_nearest',
  collecting: false,
  historyExpanded: false,
  filters: Object.fromEntries(facetConfig.map((facet) => [facet.key, []])),
  facets: {},
  facetSearch: {},
  requestSequence: 0,
  openFacets: new Set(facetConfig.filter((facet) => facet.open).map((facet) => facet.key)),
};
const viewerState = {
  images: [],
  index: 0,
  scale: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
  pointerId: null,
  dragStartX: 0,
  dragStartY: 0,
  dragOriginX: 0,
  dragOriginY: 0,
  returnFocus: null,
};
const byId = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  state.historyExpanded = storedHistoryPreference();
  hydrateStateFromUrl();
  bindEvents();
  reflectCollectionHistoryState();
  reflectStateInControls();
  void loadCollectionSites();
  void loadDashboard();
  setInterval(pollCollection, 3000);
});

function bindEvents() {
  let searchTimer;
  byId('search-input').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    byId('search-clear').hidden = !event.target.value;
    searchTimer = setTimeout(() => {
      state.search = event.target.value.trim();
      state.page = 1;
      applyState();
    }, 300);
  });
  byId('search-clear').addEventListener('click', () => {
    byId('search-input').value = '';
    byId('search-clear').hidden = true;
    state.search = '';
    state.page = 1;
    applyState();
  });
  byId('source-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-catalog]');
    if (!button) return;
    state.catalog = button.dataset.catalog;
    state.filters = Object.fromEntries(facetConfig.map((facet) => [facet.key, []]));
    state.page = 1;
    applyState();
  });
  byId('facet-list').addEventListener('change', (event) => {
    const endingWindow = event.target.closest('[data-ending-window]');
    if (endingWindow) {
      state.endingWindowDays = endingWindow.checked ? 3 : 0;
      state.page = 1;
      applyState();
      return;
    }
    const dateInput = event.target.closest('[data-date-filter]');
    if (dateInput) {
      state[dateInput.dataset.dateFilter] = dateInput.value;
      normalizeDateRange(dateInput.dataset.dateFilter);
      state.page = 1;
      applyState();
      return;
    }
    const input = event.target.closest('[data-facet]');
    if (!input) return;
    toggleFacet(input.dataset.facet, input.value);
  });
  byId('facet-list').addEventListener('input', (event) => {
    const input = event.target.closest('[data-facet-search]');
    if (!input) return;
    state.facetSearch[input.dataset.facetSearch] = input.value;
    filterFacetOptions(input.dataset.facetSearch, input.value);
  });
  byId('facet-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-select-all-facet]');
    if (!button) return;
    toggleAllVisibleFacetOptions(button.dataset.selectAllFacet);
  });
  byId('facet-list').addEventListener('toggle', (event) => {
    if (!(event.target instanceof HTMLDetailsElement)) return;
    const key = event.target.dataset.facetGroup;
    if (event.target.open) state.openFacets.add(key); else state.openFacets.delete(key);
  }, true);
  byId('active-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-facet]');
    if (button) toggleFacet(button.dataset.removeFacet, button.dataset.value);
  });
  byId('clear-filters').addEventListener('click', clearFilters);
  byId('previous-page').addEventListener('click', () => changePage(state.page - 1));
  byId('next-page').addEventListener('click', () => changePage(state.page + 1));
  byId('grid-view').addEventListener('click', () => setView('grid'));
  byId('list-view').addEventListener('click', () => setView('list'));
  byId('sort-select').addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.page = 1;
    applyState();
  });
  byId('page-size-select').addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    state.page = 1;
    applyState();
  });
  byId('collect-button').addEventListener('click', startCollection);
  byId('collection-history-toggle').addEventListener('click', toggleCollectionHistory);
  byId('mobile-filter-button').addEventListener('click', openFilters);
  byId('close-filters').addEventListener('click', closeFilters);
  byId('filter-backdrop').addEventListener('click', closeFilters);
  byId('close-dialog').addEventListener('click', () => byId('lot-dialog').close());
  byId('lot-dialog').addEventListener('click', (event) => { if (event.target === byId('lot-dialog')) byId('lot-dialog').close(); });
  byId('viewer-close').addEventListener('click', closeImageViewer);
  byId('image-viewer').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeImageViewer();
  });
  byId('viewer-previous').addEventListener('click', () => changeViewerImage(-1));
  byId('viewer-next').addEventListener('click', () => changeViewerImage(1));
  byId('viewer-zoom-in').addEventListener('click', () => changeViewerZoom(.25));
  byId('viewer-zoom-out').addEventListener('click', () => changeViewerZoom(-.25));
  byId('viewer-zoom-reset').addEventListener('click', resetViewerTransform);
  byId('viewer-rotate-left').addEventListener('click', () => rotateViewer(-90));
  byId('viewer-rotate-right').addEventListener('click', () => rotateViewer(90));
  byId('viewer-fullscreen').addEventListener('click', toggleViewerFullscreen);
  byId('viewer-thumbnails').addEventListener('click', (event) => {
    const thumbnail = event.target.closest('[data-viewer-index]');
    if (thumbnail) selectViewerImage(Number(thumbnail.dataset.viewerIndex));
  });
  byId('viewer-stage').addEventListener('wheel', handleViewerWheel, { passive: false });
  byId('viewer-stage').addEventListener('dblclick', () => viewerState.scale > 1 ? resetViewerTransform() : changeViewerZoom(1));
  byId('viewer-stage').addEventListener('pointerdown', startViewerDrag);
  byId('viewer-stage').addEventListener('pointermove', moveViewerDrag);
  byId('viewer-stage').addEventListener('pointerup', endViewerDrag);
  byId('viewer-stage').addEventListener('pointercancel', endViewerDrag);
  document.addEventListener('keydown', handleViewerKeyboard, true);
  document.addEventListener('fullscreenchange', () => byId('viewer-fullscreen').classList.toggle('active', document.fullscreenElement === byId('image-viewer')));
  if (!document.fullscreenEnabled) byId('viewer-fullscreen').hidden = true;
  window.addEventListener('popstate', () => {
    hydrateStateFromUrl();
    reflectStateInControls();
    void refreshCatalog(false);
  });
}

async function loadDashboard() {
  await Promise.all([loadSourceNav(), refreshCatalog(false), pollCollection()]);
}

async function loadSourceNav() {
  const [catalogs, integrations] = await Promise.all([api('/api/catalogs'), api('/api/integrations')]);
  const counts = Object.fromEntries(catalogs.map((item) => [item.catalog, item.lotCount]));
  byId('source-nav').innerHTML = [['vehicles', 'Veículos'], ['real_estate', 'Imóveis']]
    .map(([catalog, label]) => `<button class="source-tab" type="button" data-catalog="${catalog}">${label}<small>${number(counts[catalog] || 0)}</small></button>`).join('')
    + `<a class="source-tab integrations-tab" href="/integrations.html">Integrações<small>${integrations.length}</small></a>`;
  reflectStateInControls();
}

function renderStats(data) {
  byId('stat-total').textContent = number(data.totalLots);
  byId('stat-events').textContent = number(data.totalEvents);
  byId('stat-active').textContent = number(data.activeLots);
  byId('stat-results').textContent = number(data.lotsWithResult);
  byId('stat-average').textContent = currency(data.averageBid);
  byId('stat-images').textContent = number(data.downloadedImages);
  byId('stat-images').title = `${number(data.downloadedImages)} de ${number(data.totalImages)} imagens baixadas · ${fileSize(data.imageBytes)}`;
  byId('stat-documents').textContent = number(data.downloadedDocuments);
  byId('stat-documents').title = `${number(data.downloadedDocuments)} de ${number(data.totalDocuments)} documentos baixados · ${fileSize(data.documentBytes)}`;
  byId('stat-storage').textContent = fileSize(data.mediaBytes);
  byId('stat-storage').title = 'Espaço ocupado por imagens e documentos baixados';
  byId('last-updated').textContent = data.lastUpdatedAt ? `Atualizado ${relativeTime(data.lastUpdatedAt)}` : 'Aguardando primeira coleta';
}

async function refreshCatalog(updateUrl = true) {
  const sequence = ++state.requestSequence;
  if (updateUrl) syncUrl();
  reflectStateInControls();
  byId('lot-list').classList.add('loading');
  const filterParams = buildParams(false);
  const lotParams = buildParams(true);
  try {
    const [facetData, lotData, statsData, historyData] = await Promise.all([
      api(`/api/lots/facets?${filterParams}`),
      api(`/api/lots?${lotParams}`),
      api(`/api/stats?${filterParams}`),
      api(`/api/collection/history?limit=10${state.filters.site.length === 1 ? `&site=${encodeURIComponent(state.filters.site[0])}` : ''}`),
    ]);
    if (sequence !== state.requestSequence) return;
    state.facets = facetData.facets;
    state.total = lotData.total;
    renderStats(statsData);
    renderCollectionHistory(historyData);
    renderFacets();
    renderActiveFilters();
    renderLots(lotData);
  } catch (error) {
    if (sequence !== state.requestSequence) return;
    byId('lot-list').innerHTML = `<div class="request-error">Não foi possível carregar os bens. ${escapeHtml(error.message)}</div>`;
  } finally {
    if (sequence === state.requestSequence) byId('lot-list').classList.remove('loading');
  }
}

function renderCollectionHistory(runs) {
  const body = byId('collection-history-body');
  const health = byId('collection-health');
  if (!runs.length) {
    body.innerHTML = '<tr><td colspan="8" class="history-empty">Nenhuma varredura registrada para esta origem.</td></tr>';
    health.className = 'collection-health neutral';
    health.innerHTML = '<i aria-hidden="true"></i><span>Aguardando primeira execução</span>';
    return;
  }
  const latestState = collectionRunState(runs[0]);
  health.className = `collection-health ${latestState.className}`;
  health.innerHTML = `<i aria-hidden="true"></i><span>${escapeHtml(latestState.healthLabel)}</span>`;
  body.innerHTML = runs.map((run) => {
    const runState = collectionRunState(run);
    const errorTitle = run.error ? ` title="${escapeAttr(run.error)}"` : '';
    return `<tr>
      <td><strong>${dateTime(run.startedAt)}</strong><small>${relativeTime(run.startedAt)}</small></td>
      <td>${escapeHtml(run.site ? siteLabel(run.site) : 'Todos os sites')}</td>
      <td><span class="run-status ${runState.className}"${errorTitle}><i aria-hidden="true"></i>${escapeHtml(runState.label)}</span></td>
      <td class="metric new">${number(run.newCount)}</td>
      <td class="metric updated">${number(run.updatedCount)}</td>
      <td class="metric">${number(run.unchangedCount)}</td>
      <td class="metric ${Number(run.failedCount) ? 'failed' : ''}">${number(run.failedCount)}</td>
      <td>${runDuration(run.startedAt, run.finishedAt)}</td>
    </tr>`;
  }).join('');
}

function toggleCollectionHistory() {
  state.historyExpanded = !state.historyExpanded;
  try { localStorage.setItem('collection-history-expanded', String(state.historyExpanded)); } catch {}
  reflectCollectionHistoryState();
}

function reflectCollectionHistoryState() {
  const toggle = byId('collection-history-toggle');
  const content = byId('collection-history-content');
  toggle.setAttribute('aria-expanded', String(state.historyExpanded));
  toggle.textContent = state.historyExpanded ? 'Recolher' : 'Ver histórico';
  content.hidden = !state.historyExpanded;
}

function storedHistoryPreference() {
  try { return localStorage.getItem('collection-history-expanded') === 'true'; } catch { return false; }
}

function collectionRunState(run) {
  if (run.status === 'running') return { className: 'running', label: 'Em andamento', healthLabel: 'Varredura em andamento' };
  if (run.status === 'failed') return { className: 'failed', label: 'Falhou', healthLabel: 'Última varredura falhou' };
  if (Number(run.failedCount) > 0) return { className: 'warning', label: 'Parcial', healthLabel: 'Última varredura teve falhas' };
  return { className: 'success', label: 'Concluída', healthLabel: 'Coleta atualizada normalmente' };
}

function runDuration(startedAt, finishedAt) {
  if (!startedAt) return '-';
  if (!finishedAt) return 'Em andamento';
  const seconds = Math.max(0, Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function renderFacets() {
  const panel = byId('filter-panel');
  const previousScrollTop = panel.scrollTop;
  const focusedSearch = document.activeElement?.matches?.('[data-facet-search]')
    ? {
        key: document.activeElement.dataset.facetSearch,
        start: document.activeElement.selectionStart,
        end: document.activeElement.selectionEnd,
      }
    : null;
  byId('facet-list').innerHTML = endingWindowMarkup() + facetConfig.filter((config) => !config.catalog || config.catalog === state.catalog).map((config) => {
    const selected = state.filters[config.key] || [];
    const sourceOptions = [...new Map((state.facets[config.key] || []).map((option) => {
      const value = String(option.value).trim();
      return [value, { ...option, value }];
    })).values()];
    if (config.key === 'year') sourceOptions.sort((left, right) => Number(right.value) - Number(left.value));
    const options = [...sourceOptions];
    selected.forEach((value) => {
      if (!options.some((option) => option.value === value)) options.unshift({ value, label: value, count: 0 });
    });
    if (!options.length) return config.key === 'year' ? dateRangeMarkup() : '';
    const search = state.facetSearch[config.key] || '';
    const searchField = config.searchable
      ? `<label class="facet-search"><span class="search-icon" aria-hidden="true"></span><input type="search" data-facet-search="${config.key}" value="${escapeAttr(search)}" placeholder="Buscar ${escapeAttr(config.label.toLowerCase())}" autocomplete="off"></label>`
      : '';
    const facet = `<details class="facet-group" data-facet-group="${config.key}" ${state.openFacets.has(config.key) || selected.length ? 'open' : ''}>
      <summary><span>${escapeHtml(config.label)}</span>${selected.length ? `<b>${selected.length}</b>` : ''}</summary>
      ${searchField}<div class="facet-options"><button class="facet-select-all" type="button" data-select-all-facet="${config.key}" hidden><span>Selecionar todos</span><small></small></button>${options.map((option) => facetOption(config, option, selected)).join('')}<span class="facet-no-match" hidden>Nenhuma opção encontrada</span></div>
    </details>`;
    return facet + (config.key === 'year' ? dateRangeMarkup() : '');
  }).join('');
  Object.entries(state.facetSearch).forEach(([key, value]) => filterFacetOptions(key, value));
  panel.scrollTop = previousScrollTop;
  if (focusedSearch) {
    const input = byId('facet-list').querySelector(`[data-facet-search="${focusedSearch.key}"]`);
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(focusedSearch.start, focusedSearch.end);
  }
}

function endingWindowMarkup() {
  return `<div class="ending-window-filter"><strong>Encerramento próximo</strong><label><input type="checkbox" data-ending-window ${state.endingWindowDays === 3 ? 'checked' : ''}><span>3 dias atrás até 3 dias à frente</span></label></div>`;
}

function dateRangeMarkup() {
  return `<div class="date-range-filter"><strong>Data do evento</strong><div><label><span>De</span><input type="date" data-date-filter="eventDateFrom" value="${escapeAttr(state.eventDateFrom)}"></label><label><span>Até</span><input type="date" data-date-filter="eventDateTo" value="${escapeAttr(state.eventDateTo)}"></label></div></div>`;
}

function facetOption(config, option, selected) {
  const checked = selected.includes(option.value);
  const label = facetLabel(config.key, option.label || option.value);
  return `<label class="facet-option" data-facet-label="${escapeAttr(normalizeSearch(label))}"><input type="checkbox" data-facet="${config.key}" value="${escapeAttr(option.value)}" ${checked ? 'checked' : ''}><span title="${escapeAttr(label)}">${escapeHtml(label)}</span><small>${number(option.count)}</small></label>`;
}

function filterFacetOptions(key, query) {
  const group = document.querySelector(`[data-facet-group="${key}"]`);
  if (!group) return;
  const normalized = normalizeSearch(query);
  let visible = 0;
  group.querySelectorAll('.facet-option').forEach((option) => {
    const matches = !normalized || option.dataset.facetLabel.includes(normalized);
    option.hidden = !matches;
    if (matches) visible += 1;
  });
  const empty = group.querySelector('.facet-no-match');
  if (empty) empty.hidden = visible > 0;
  const selectAll = group.querySelector('[data-select-all-facet]');
  if (selectAll) {
    const visibleInputs = [...group.querySelectorAll('.facet-option:not([hidden]) input[data-facet]')];
    const allSelected = visibleInputs.length > 0 && visibleInputs.every((input) => input.checked);
    selectAll.hidden = !normalized || visible === 0;
    selectAll.querySelector('span').textContent = allSelected ? 'Remover todos' : 'Selecionar todos';
    selectAll.querySelector('small').textContent = number(visible);
  }
}

function toggleAllVisibleFacetOptions(key) {
  const group = document.querySelector(`[data-facet-group="${key}"]`);
  if (!group) return;
  const visibleInputs = [...group.querySelectorAll('.facet-option:not([hidden]) input[data-facet]')];
  const values = visibleInputs.map((input) => input.value);
  if (!values.length) return;
  const current = state.filters[key] || [];
  const allSelected = values.every((value) => current.includes(value));
  state.filters[key] = allSelected
    ? current.filter((value) => !values.includes(value))
    : [...new Set([...current, ...values])];
  state.page = 1;
  applyState();
}

function renderActiveFilters() {
  const chips = [];
  if (state.search) chips.push(`<button type="button" data-remove-search>Busca: ${escapeHtml(state.search)} <span>&times;</span></button>`);
  if (state.eventDateFrom) chips.push(`<button type="button" data-remove-date="eventDateFrom">A partir de ${escapeHtml(shortDate(state.eventDateFrom))} <span>&times;</span></button>`);
  if (state.eventDateTo) chips.push(`<button type="button" data-remove-date="eventDateTo">Até ${escapeHtml(shortDate(state.eventDateTo))} <span>&times;</span></button>`);
  if (state.endingWindowDays === 3) chips.push('<button type="button" data-remove-ending-window>Encerramento: ±3 dias <span>&times;</span></button>');
  facetConfig.forEach((config) => state.filters[config.key].forEach((value) => {
    const option = (state.facets[config.key] || []).find((candidate) => candidate.value === value);
    chips.push(`<button type="button" data-remove-facet="${config.key}" data-value="${escapeAttr(value)}">${escapeHtml(facetLabel(config.key, option?.label || value))} <span>&times;</span></button>`);
  }));
  const container = byId('active-filters');
  container.hidden = chips.length === 0;
  container.innerHTML = chips.join('') + (chips.length ? '<button class="clear-chip" type="button" data-clear-all>Limpar tudo</button>' : '');
  container.querySelector('[data-remove-search]')?.addEventListener('click', () => {
    state.search = ''; byId('search-input').value = ''; byId('search-clear').hidden = true; state.page = 1; applyState();
  });
  container.querySelectorAll('[data-remove-date]').forEach((button) => button.addEventListener('click', () => {
    state[button.dataset.removeDate] = '';
    state.page = 1;
    applyState();
  }));
  container.querySelector('[data-remove-ending-window]')?.addEventListener('click', () => {
    state.endingWindowDays = 0;
    state.page = 1;
    applyState();
  });
  container.querySelector('[data-clear-all]')?.addEventListener('click', clearFilters);
  const count = activeFilterCount();
  byId('mobile-filter-count').textContent = String(count);
}

function renderLots(data) {
  const totalPages = Math.max(1, Math.ceil(data.total / state.pageSize));
  byId('result-count').textContent = `${number(data.total)} ${data.total === 1 ? 'bem encontrado' : 'bens encontrados'}`;
  byId('page-label').textContent = `Página ${state.page} de ${totalPages}`;
  byId('pagination-label').textContent = `${state.page} / ${totalPages}`;
  byId('previous-page').disabled = state.page <= 1;
  byId('next-page').disabled = state.page >= totalPages;
  byId('empty-state').hidden = data.items.length > 0;
  byId('lot-list').innerHTML = data.items.map(lotCard).join('');
  byId('lot-list').querySelectorAll('[data-lot-id]').forEach((card) => {
    card.addEventListener('click', () => openLot(card.dataset.lotId));
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') openLot(card.dataset.lotId); });
  });
}

function lotCard(lot) {
  const image = lot.primaryImage
    ? `<img src="${escapeAttr(lot.primaryImage)}" alt="${escapeAttr(lot.title)}" loading="lazy">`
    : '<div class="image-placeholder"></div>';
  const location = [lot.city, lot.state].filter(Boolean).join(' / ') || 'Local não informado';
  const year = [lot.manufactureYear, lot.modelYear].filter(Boolean).join(' / ') || '-';
  const status = lot.businessStatus || businessStateLabel(lot.businessState);
  const condition = lot.vehicleCondition ? ` · ${facetLabel('vehicleCondition', lot.vehicleCondition)}` : '';
  const facts = lot.assetType === 'real_estate'
    ? `<dl class="vehicle-facts"><div><dt>Tipo</dt><dd>${escapeHtml(lot.propertyType || 'Imóvel')}</dd></div><div><dt>Área</dt><dd>${areaLabel(lot.privateAreaM2 || lot.totalAreaM2)}</dd></div><div><dt>Local</dt><dd>${escapeHtml([lot.neighborhood, location].filter(Boolean).join(' · '))}</dd></div></dl>`
    : `<dl class="vehicle-facts"><div><dt>Ano</dt><dd>${escapeHtml(year)}</dd></div><div><dt>KM</dt><dd>${lot.mileage == null ? '-' : number(lot.mileage)}</dd></div><div><dt>Local</dt><dd>${escapeHtml(location)}</dd></div></dl>`;
  const roundValues = [
    ['1ª praça', lot.firstRoundMinimumValue],
    ['2ª praça', lot.secondRoundMinimumValue],
    ['3ª praça', lot.thirdRoundMinimumValue],
    ...(Number(lot.currentBid) > 0 ? [['Lance atual', lot.currentBid]] : []),
  ].filter(([, value]) => Number(value) > 0);
  const priceBlock = lot.assetType === 'real_estate' && roundValues.length
    ? `<div class="bid-block round-values">${roundValues.map(([label, value]) => `<div><span>${label}</span><strong>${currency(value)}</strong></div>`).join('')}<small>${endingText(lot.auctionEnd)}</small></div>`
    : `<div class="bid-block"><span>${lot.assetType === 'real_estate' ? 'Valor atual' : 'Lance atual'}</span><strong>${currency(lot.currentBid)}</strong><small>${endingText(lot.auctionEnd)}</small></div>`;
  return `<article class="lot-card" tabindex="0" data-lot-id="${lot.id}">
    <figure>${image}<span class="status-badge status-${escapeAttr(lot.businessState || 'other')}">${escapeHtml(status)}</span><span class="source-badge">${escapeHtml(siteLabel(lot.site))}</span></figure>
    <div class="lot-card-body">
      <div class="lot-identity"><span>${escapeHtml(assetTypeLabel(lot.assetType))}${escapeHtml(condition)} · Lote ${escapeHtml(lot.lotNumber || '-')} · ${number(lot.imageCount)} fotos</span><h2>${escapeHtml(lot.title)}</h2><small>${escapeHtml(lot.eventName || 'Evento não identificado')}</small></div>
      ${facts}
      ${priceBlock}
    </div>
  </article>`;
}

function toggleFacet(key, value) {
  const current = state.filters[key] || [];
  if (key === 'runningAtEntry') {
    state.filters[key] = current.includes(value) ? [] : [value];
  } else {
    state.filters[key] = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  }
  if (key === 'site') state.filters.event = [];
  state.page = 1;
  applyState();
}

function clearFilters() {
  state.search = '';
  state.eventDateFrom = '';
  state.eventDateTo = '';
  state.endingWindowDays = 0;
  state.filters = Object.fromEntries(facetConfig.map((facet) => [facet.key, []]));
  state.page = 1;
  byId('search-input').value = '';
  byId('search-clear').hidden = true;
  applyState();
}

function applyState() {
  void refreshCatalog(true);
}

function changePage(page) {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (page < 1 || page > totalPages) return;
  state.page = page;
  syncUrl();
  void refreshCatalog(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setView(view) {
  state.view = view;
  reflectStateInControls();
  syncUrl();
}

function reflectStateInControls() {
  byId('search-input').value = state.search;
  byId('search-clear').hidden = !state.search;
  byId('lot-list').className = `lot-results ${state.view}-view`;
  byId('grid-view').classList.toggle('active', state.view === 'grid');
  byId('list-view').classList.toggle('active', state.view === 'list');
  byId('sort-select').value = state.sort;
  byId('page-size-select').value = String(state.pageSize);
  document.querySelectorAll('[data-catalog]').forEach((button) => button.classList.toggle('active', button.dataset.catalog === state.catalog));
}

function hydrateStateFromUrl() {
  const params = new URLSearchParams(location.search);
  state.catalog = params.get('catalog') === 'real_estate' ? 'real_estate' : 'vehicles';
  state.search = params.get('search') || '';
  state.eventDateFrom = validDateValue(params.get('eventDateFrom'));
  state.eventDateTo = validDateValue(params.get('eventDateTo'));
  state.endingWindowDays = params.get('endingWindowDays') === '3' ? 3 : 0;
  state.page = positiveNumber(params.get('page'), 1);
  state.pageSize = [24, 48, 72, 100].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 24;
  state.view = params.get('view') === 'list' ? 'list' : 'grid';
  state.sort = ['auction_nearest', 'auction_desc', 'auction_asc', 'year_desc', 'year_asc', 'brand_asc', 'brand_desc'].includes(params.get('sort')) ? params.get('sort') : 'auction_nearest';
  facetConfig.forEach((config) => {
    state.filters[config.key] = [...new Set(params.getAll(config.param).flatMap((value) => value.split(',')).filter(Boolean))];
  });
}

function buildParams(includePage) {
  const params = new URLSearchParams();
  params.set('catalog', state.catalog);
  (state.catalog === 'real_estate' ? ['real_estate'] : ['car', 'motorcycle', 'heavy'])
    .forEach((value) => params.append('assetType', value));
  if (state.search) params.set('search', state.search);
  if (state.eventDateFrom) params.set('eventDateFrom', state.eventDateFrom);
  if (state.eventDateTo) params.set('eventDateTo', state.eventDateTo);
  if (state.endingWindowDays === 3) params.set('endingWindowDays', '3');
  if (state.sort !== 'auction_nearest') params.set('sort', state.sort);
  facetConfig.forEach((config) => state.filters[config.key].forEach((value) => params.append(config.param, value)));
  if (includePage) {
    params.set('page', state.page);
    params.set('pageSize', state.pageSize);
  }
  return params;
}

function syncUrl() {
  const params = buildParams(true);
  if (state.view !== 'grid') params.set('view', state.view);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function activeFilterCount() {
  return facetConfig.reduce((total, config) => total + state.filters[config.key].length, 0)
    + Number(Boolean(state.eventDateFrom)) + Number(Boolean(state.eventDateTo)) + Number(state.endingWindowDays === 3);
}

function openFilters() {
  byId('filter-panel').classList.add('open');
  byId('filter-backdrop').hidden = false;
  document.body.classList.add('filters-open');
}

function closeFilters() {
  byId('filter-panel').classList.remove('open');
  byId('filter-backdrop').hidden = true;
  document.body.classList.remove('filters-open');
}

async function openLot(id) {
  const lot = await api(`/api/lots/${id}`);
  const media = lot.media || [];
  const images = media.filter((item) => item.type === 'image');
  const documents = media.filter((item) => item.type === 'document');
  const video = media.find((item) => item.type === 'video');
  const gallery = images.length
    ? `<div class="detail-gallery">${images.map((item, index) => `<button type="button" data-detail-image="${index}" aria-label="Ampliar foto ${index + 1}"><img src="${escapeAttr(mediaUrl(item))}" alt="${escapeAttr(lot.title)} - foto ${index + 1}" loading="lazy"></button>`).join('')}</div>`
    : '';
  const snapshots = (lot.snapshots || []).map((item) => `<tr><td>${dateTime(item.observedAt)}</td><td>${currency(item.currentBid)}</td><td>${currency(item.totalCost)}</td><td>${escapeHtml(item.businessStatus || statusValue(item.saleStatus) || '-')}</td></tr>`).join('');
  const bids = (lot.bids || []).map((item) => `<tr><td>${dateTime(item.observedAt)}</td><td>${escapeHtml(item.bidderAlias || '-')}</td><td>${currency(item.amount)}</td><td>${escapeHtml(item.bidType || '-')}</td></tr>`).join('');
  const changes = (lot.changes || []).map(changeItem).join('');
  const equipment = [
    ['Ar condicionado', lot.air_conditioning],
    ['Câmbio', lot.transmission],
    ['Chave', lot.key_available],
    ['Direção', lot.steering],
    ['Trava', lot.locks],
    ['Vidro', lot.windows],
  ];
  const isRealEstate = lot.asset_type === 'real_estate';
  const equipmentSection = !isRealEstate && equipment.some(([, value]) => hasCollectedValue(value))
    ? `<section class="detail-section"><h3>Equipamentos e características</h3><div class="detail-grid compact">${equipment.map(([label, value]) => detailCell(label, value || '-')).join('')}</div></section>`
    : '';
  const rawData = typeof lot.raw_data_json === 'string' ? JSON.parse(lot.raw_data_json) : (lot.raw_data_json || {});
  const additionalDetails = Object.entries(rawData.additionalDetails || {}).filter(([, value]) => hasCollectedValue(value));
  const additionalDetailsSection = additionalDetails.length
    ? `<section class="detail-section"><h3>Vistoria e opcionais</h3><div class="detail-grid compact">${additionalDetails.map(([label, value]) => detailCell(label, value)).join('')}</div></section>`
    : '';
  const documentsSection = documents.length
    ? `<section class="detail-section"><h3>Documentos</h3><div class="document-list">${documents.map((document, index) => `<a href="${escapeAttr(mediaUrl(document))}" target="_blank" rel="noopener"><span>${escapeHtml(document.label || `Documento ${index + 1}`)}</span><strong>${escapeHtml(documentTypeLabel(document.documentType) || fileTypeLabel(document.sourceUrl))}</strong></a>`).join('')}</div></section>`
    : '';
  const inspection = [
    ['Condição', lot.vehicle_condition], ['Motor', lot.engine_condition], ['Lataria', lot.body_condition],
    ['Pintura', lot.paint_condition], ['Tapeçaria', lot.upholstery_condition], ['Pneus', lot.tire_condition],
    ['Rodas', lot.wheel_type], ['Portas', lot.door_count], ['Bancos', lot.seat_type],
    ['Som', lot.sound_system], ['Chassi', lot.chassis_condition], ['Restrições', lot.vehicle_restrictions],
    ['Situação fiscal', lot.tax_status], ['Débitos', lot.debt_notes], ['Referência', lot.reference_code],
  ].filter(([, value]) => hasCollectedValue(value));
  const inspectionSection = !isRealEstate && inspection.length
    ? `<section class="detail-section"><h3>Condição e vistoria</h3><div class="detail-grid compact">${inspection.map(([label, value]) => detailCell(label, value)).join('')}</div><small>Extração: ${escapeHtml(lot.extraction_confidence || '-')}</small></section>`
    : '';
  const lotDetails = isRealEstate
    ? `${detailCell('Imóvel', lot.title, 'wide')}${detailCell('Tipo', lot.property_type || 'Imóvel')}${detailCell('Código', lot.external_code || '-')}
      ${detailCell('Lote', lot.lot_number || '-')}${detailCell('Área privativa', areaLabel(lot.private_area_m2))}${detailCell('Área total', areaLabel(lot.total_area_m2))}
      ${detailCell('Ocupação', lot.occupancy_status || '-')}${detailCell('Aceita financiamento', booleanLabel(lot.accepts_financing))}${detailCell('CEP', lot.postal_code || '-')}
      ${detailCell('Comitente', lot.consignor || '-', 'wide')}${detailCell('Bairro', lot.neighborhood || '-')}
      ${detailCell('Localização', lot.address || [lot.city, lot.state].filter(Boolean).join(' / ') || '-', 'wide')}`
    : `${detailCell('Veículo', lot.title, 'wide')}${detailCell('Tipo', assetTypeLabel(lot.asset_type))}${detailCell('Código', lot.external_code || '-')}
      ${detailCell('Lote', lot.lot_number || '-')}${detailCell('Ano', [lot.manufacture_year, lot.model_year].filter(Boolean).join(' / ') || '-')}${detailCell('Cor', lot.color || '-')}${detailCell('Combustível', lot.fuel || '-')}
      ${detailCell('KM', lot.mileage == null ? '-' : number(lot.mileage))}
      ${detailCell('Funcionando na entrada', booleanLabel(lot.running_at_entry))}${detailCell('Final da placa', [lot.plate_final, lot.plate_state].filter(Boolean).join(' - ') || '-')}
      ${detailCell('Comitente', lot.consignor || '-', 'wide')}${detailCell('Procedência', lot.origin || '-', 'wide')}
      ${detailCell('Localização', lot.address || [lot.city, lot.state].filter(Boolean).join(' / ') || '-', 'wide')}`;
  byId('lot-detail').innerHTML = `${gallery}<div class="detail-content">
    <div class="detail-heading"><div><span>${escapeHtml(siteLabel(lot.site))} · Lote ${escapeHtml(lot.lot_number || '-')}</span><h2>${escapeHtml(lot.title)}</h2><p>${escapeHtml(lot.event_name || '')}</p></div><strong>${currency(lot.current_bid)}</strong></div>
    <div class="detail-grid">
      ${detailCell('Status', lot.businessStatus || statusValue(lot.sale_status))}${detailCell('Licitante atual', lot.current_bidder_alias || '-')}
      ${detailCell('Custo total', currency(lot.total_cost))}${detailCell('Encerramento', dateTime(lot.auction_end))}
    </div>
    <section class="detail-section"><h3>Detalhes do lote</h3><div class="detail-grid lot-details">
      ${lotDetails}
    </div></section>
    ${equipmentSection}
    ${inspectionSection}
    ${additionalDetailsSection}
    <section class="detail-section"><h3>Observações</h3><p class="description-text">${escapeHtml(lot.observations || 'Nenhuma observação coletada nesta listagem.')}</p></section>
    ${documentsSection}
    ${video ? `<section class="detail-section"><h3>Vídeo</h3><a href="${escapeAttr(video.sourceUrl)}" target="_blank" rel="noopener">Abrir vídeo original</a></section>` : ''}
    <section class="detail-section"><h3>Alterações do anúncio</h3>${changes ? `<ol class="change-timeline">${changes}</ol>` : '<p>Nenhuma alteração detectada até agora.</p>'}</section>
    <section class="detail-section"><h3>Histórico observado</h3><div class="table-scroll"><table class="snapshot-table"><thead><tr><th>Coleta</th><th>Lance</th><th>Total</th><th>Status</th></tr></thead><tbody>${snapshots || '<tr><td colspan="4">Sem snapshots.</td></tr>'}</tbody></table></div></section>
    ${bids ? `<section class="detail-section"><h3>Histórico de lances</h3><div class="table-scroll"><table class="snapshot-table"><thead><tr><th>Data</th><th>Licitante</th><th>Valor</th><th>Tipo</th></tr></thead><tbody>${bids}</tbody></table></div></section>` : ''}
    <section class="detail-section"><a class="original-link" href="${escapeAttr(lot.url)}" target="_blank" rel="noopener">Abrir anúncio original</a></section>
  </div>`;
  const viewerImages = images.map((item, index) => ({
    url: mediaUrl(item),
    alt: `${lot.title} - foto ${index + 1}`,
  }));
  byId('lot-detail').querySelectorAll('[data-detail-image]').forEach((button) => button.addEventListener('click', () => {
    openImageViewer(viewerImages, Number(button.dataset.detailImage), lot.title);
  }));
  byId('lot-dialog').showModal();
}

function openImageViewer(images, index, title) {
  if (!images.length) return;
  viewerState.returnFocus = document.activeElement;
  viewerState.images = images;
  viewerState.index = index;
  byId('viewer-title').textContent = title || 'Imagem do lote';
  byId('viewer-thumbnails').innerHTML = images.map((image, imageIndex) => `<button type="button" data-viewer-index="${imageIndex}" aria-label="Abrir foto ${imageIndex + 1}"><img src="${escapeAttr(image.url)}" alt=""></button>`).join('');
  if (!byId('image-viewer').open) byId('image-viewer').showModal();
  document.body.classList.add('viewer-open');
  resetViewerTransform();
  renderViewerImage();
  byId('image-viewer').focus();
}

function closeImageViewer() {
  if (!byId('image-viewer').open) return;
  byId('image-viewer').close();
  document.body.classList.remove('viewer-open');
  if (document.fullscreenElement === byId('image-viewer')) void document.exitFullscreen();
  viewerState.returnFocus?.focus?.();
}

function changeViewerImage(direction) {
  if (!viewerState.images.length) return;
  selectViewerImage((viewerState.index + direction + viewerState.images.length) % viewerState.images.length);
}

function selectViewerImage(index) {
  if (!Number.isInteger(index) || index < 0 || index >= viewerState.images.length) return;
  viewerState.index = index;
  resetViewerTransform();
  renderViewerImage();
}

function renderViewerImage() {
  const current = viewerState.images[viewerState.index];
  if (!current) return;
  const image = byId('viewer-image');
  if (image.getAttribute('src') !== current.url) image.src = current.url;
  image.alt = current.alt;
  byId('viewer-counter').textContent = `${viewerState.index + 1} / ${viewerState.images.length}`;
  byId('viewer-previous').disabled = viewerState.images.length < 2;
  byId('viewer-next').disabled = viewerState.images.length < 2;
  byId('viewer-thumbnails').querySelectorAll('[data-viewer-index]').forEach((thumbnail) => {
    const active = Number(thumbnail.dataset.viewerIndex) === viewerState.index;
    thumbnail.classList.toggle('active', active);
    if (active) thumbnail.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });
  applyViewerTransform();
}

function changeViewerZoom(amount) {
  viewerState.scale = Math.min(5, Math.max(1, Math.round((viewerState.scale + amount) * 100) / 100));
  if (viewerState.scale === 1) {
    viewerState.panX = 0;
    viewerState.panY = 0;
  }
  applyViewerTransform();
}

function resetViewerTransform() {
  viewerState.scale = 1;
  viewerState.rotation = 0;
  viewerState.panX = 0;
  viewerState.panY = 0;
  applyViewerTransform();
}

function rotateViewer(degrees) {
  viewerState.rotation = (viewerState.rotation + degrees) % 360;
  viewerState.panX = 0;
  viewerState.panY = 0;
  applyViewerTransform();
}

function applyViewerTransform() {
  const image = byId('viewer-image');
  image.style.transform = `translate(${viewerState.panX}px, ${viewerState.panY}px) scale(${viewerState.scale}) rotate(${viewerState.rotation}deg)`;
  byId('viewer-zoom-level').textContent = `${Math.round(viewerState.scale * 100)}%`;
  byId('viewer-zoom-out').disabled = viewerState.scale <= 1;
  byId('viewer-stage').classList.toggle('can-pan', viewerState.scale > 1 || viewerState.rotation % 180 !== 0);
}

function handleViewerWheel(event) {
  if (!byId('image-viewer').open) return;
  event.preventDefault();
  changeViewerZoom(event.deltaY < 0 ? .25 : -.25);
}

function startViewerDrag(event) {
  if ((viewerState.scale <= 1 && viewerState.rotation % 180 === 0) || event.button !== 0) return;
  viewerState.pointerId = event.pointerId;
  viewerState.dragStartX = event.clientX;
  viewerState.dragStartY = event.clientY;
  viewerState.dragOriginX = viewerState.panX;
  viewerState.dragOriginY = viewerState.panY;
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add('dragging');
}

function moveViewerDrag(event) {
  if (viewerState.pointerId !== event.pointerId) return;
  viewerState.panX = viewerState.dragOriginX + event.clientX - viewerState.dragStartX;
  viewerState.panY = viewerState.dragOriginY + event.clientY - viewerState.dragStartY;
  applyViewerTransform();
}

function endViewerDrag(event) {
  if (viewerState.pointerId !== event.pointerId) return;
  viewerState.pointerId = null;
  event.currentTarget.classList.remove('dragging');
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
}

function handleViewerKeyboard(event) {
  if (!byId('image-viewer').open) return;
  const actions = {
    ArrowLeft: () => changeViewerImage(-1),
    ArrowRight: () => changeViewerImage(1),
    Home: () => selectViewerImage(0),
    End: () => selectViewerImage(viewerState.images.length - 1),
    '+': () => changeViewerZoom(.25),
    '=': () => changeViewerZoom(.25),
    '-': () => changeViewerZoom(-.25),
    r: () => rotateViewer(90),
    R: () => rotateViewer(90),
    Escape: closeImageViewer,
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  action();
}

async function toggleViewerFullscreen() {
  const viewer = byId('image-viewer');
  if (document.fullscreenElement === viewer) await document.exitFullscreen();
  else if (viewer.requestFullscreen) await viewer.requestFullscreen();
}

function detailCell(label, value, className = '') { return `<div class="${escapeAttr(className)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value || '-'))}</strong></div>`; }
function hasCollectedValue(value) { return value !== null && value !== undefined && String(value).trim() !== '' && String(value).trim() !== '-'; }
function booleanLabel(value) { return value === true ? 'Sim' : value === false ? 'Não' : '-'; }
function fileTypeLabel(url) {
  const extension = String(url || '').split('?')[0].split('.').pop();
  return extension && extension.length <= 5 ? extension.toUpperCase() : 'Arquivo';
}

function changeItem(change) {
  if (change.changeType === 'discovered') {
    return `<li class="change-item discovered"><time>${dateTime(change.observedAt)}</time><strong>Anúncio descoberto</strong><span>Adicionado ao monitoramento.</span></li>`;
  }
  const oldValue = change.valueType === 'status' ? statusTransitionValue(undefined, change.oldValue) : changeValue(change.valueType, change.oldValue);
  const newValue = change.valueType === 'status' ? statusTransitionValue(change.oldValue, change.newValue) : changeValue(change.valueType, change.newValue);
  const bidder = change.fieldName === 'current_bid' && change.bidderAlias ? ` por ${change.bidderAlias}` : '';
  return `<li class="change-item ${change.changeType === 'status_changed' ? 'status-change' : ''}"><time>${dateTime(change.observedAt)}</time><strong>${escapeHtml(changeLabel(change.fieldName))}</strong><span><b>${escapeHtml(oldValue)}</b><i aria-hidden="true">&rarr;</i><b>${escapeHtml(newValue + bidder)}</b></span></li>`;
}

function changeLabel(field) {
  return ({ current_bid: 'Lance atual', next_bid: 'Próximo lance', final_bid: 'Valor final', commission_fee: 'Comissão', buyer_fee: 'Taxa do comprador', other_fees: 'Outras taxas', total_cost: 'Custo total', sale_status: 'Status', auction_end: 'Encerramento', sold_at: 'Data do arremate' })[field] || field || 'Alteração';
}

function changeValue(type, value) {
  if (value == null || value === '') return 'Não informado';
  if (type === 'money') return currency(Number(value));
  if (type === 'datetime') return dateTime(value);
  if (type === 'status') return statusValue(value);
  return String(value);
}

function statusTransitionValue(previous, current) {
  if (['agpagamento', 'pago'].includes(normalizeStatus(current)) && normalizeStatus(previous) === 'condicional') return 'Condicional - Aprovada';
  return statusValue(current);
}

function statusValue(value) {
  const labels = { liberadoleilao: 'Aberto para lances', abertoparaofertas: 'Aberto para lances', vendido: 'Arrematado', arrematado: 'Arrematado', condicional: 'Condicional - Aguardando aprovação', condicionalnegado: 'Condicional - Negada', condicionalnegada: 'Condicional - Negada', negadacondicional: 'Condicional - Negada', agpagamento: 'Arrematado', pago: 'Arrematado', retirado: 'Retirado', naoarrematado: 'Não arrematado', cancelado: 'Cancelado' };
  return labels[normalizeStatus(value)] || String(value || '-').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

function businessStateLabel(value) {
  return ({ open: 'Aberto para lances', conditional_pending: 'Condicional', conditional_approved: 'Condicional aprovada', conditional_rejected: 'Condicional negada', sold: 'Arrematado', unsold: 'Não arrematado', withdrawn: 'Retirado', other: 'Status não classificado' })[value] || statusValue(value);
}

function facetLabel(key, value) {
  if (key === 'site') return siteLabel(value);
  if (key === 'assetType') return assetTypeLabel(value);
  if (key === 'status') return businessStateLabel(value);
  if (key === 'runningAtEntry') return value === 'yes' ? 'Sim' : 'Não';
  if (key === 'propertyType') return String(value).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  if (key === 'vehicleCondition') return ({ sucata: 'Sucata', batido: 'Batido', avariado: 'Avariado' })[value] || value;
  return value;
}

async function startCollection() {
  const button = byId('collect-button');
  button.disabled = true;
  button.textContent = 'Coleta em andamento';
  const selectedSite = byId('collection-site-select').value;
  try {
    await api(selectedSite ? `/api/collection/${selectedSite}` : '/api/collection', { method: 'POST' });
    await pollCollection();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Atualizar coleta';
    window.alert(error.message);
  }
}

async function loadCollectionSites() {
  try {
    const integrations = await api('/api/integrations');
    byId('collection-site-select').innerHTML = '<option value="">Todos os sites</option>' + integrations
      .map((item) => `<option value="${escapeAttr(item.site)}">${escapeHtml(item.name)}</option>`).join('');
  } catch {}
}

async function pollCollection() {
  const progress = await api('/api/collection');
  const wasCollecting = state.collecting;
  state.collecting = Boolean(progress.running);
  byId('collect-button').disabled = state.collecting;
  byId('collection-site-select').disabled = state.collecting;
  byId('collect-button').textContent = state.collecting ? 'Coleta em andamento' : 'Atualizar coleta';
  byId('collection-strip').hidden = !state.collecting && !progress.lastError;
  if (state.collecting) {
    const percentage = progress.totalPages ? Math.round((progress.processedPages / progress.totalPages) * 100) : 2;
    byId('collection-title').textContent = `Atualizando ${siteLabel(progress.currentSite || progress.site) || 'catálogos'}`;
    byId('collection-detail').textContent = `${progress.processedPages}/${progress.totalPages || '?'} páginas · ${progress.new} novos · ${progress.updated} atualizados · ${progress.unchanged} sem alteração`;
    byId('collection-progress').style.width = `${percentage}%`;
  } else if (progress.lastError) {
    byId('collection-title').textContent = 'Falha na última coleta';
    byId('collection-detail').textContent = progress.lastError;
    byId('collection-progress').style.width = '100%';
  }
  if (wasCollecting && !state.collecting) await refreshCatalog(false);
}

function normalizeDateRange(changedField) {
  if (!state.eventDateFrom || !state.eventDateTo || state.eventDateFrom <= state.eventDateTo) return;
  if (changedField === 'eventDateFrom') state.eventDateTo = state.eventDateFrom;
  else state.eventDateFrom = state.eventDateTo;
}

function validDateValue(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : ''; }
function shortDate(value) { return new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T12:00:00`)); }

async function api(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

function endingText(value) {
  if (!value) return 'Encerramento não informado';
  const date = new Date(value);
  return date > new Date() ? `Encerra ${dateTime(value)}` : `Finalizado ${dateTime(value)}`;
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  return dateTime(value);
}

function positiveNumber(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function normalizeStatus(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toLowerCase(); }
function normalizeSearch(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function currency(value) { return value == null ? '-' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value); }
function number(value) { return new Intl.NumberFormat('pt-BR').format(Number(value || 0)); }
function dateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-'; }
function fileSize(value) {
  const bytes = Math.max(0, Number(value || 0));
  const units = [
    ['gigabyte', 1024 ** 3],
    ['megabyte', 1024 ** 2],
    ['kilobyte', 1024],
  ];
  const [unit, divisor] = units.find(([, threshold]) => bytes >= threshold) || ['byte', 1];
  return new Intl.NumberFormat('pt-BR', { style: 'unit', unit, maximumFractionDigits: 1 }).format(bytes / divisor);
}
function mediaUrl(item) { return item.downloadStatus === 'downloaded' ? `/api/media/${item.id}` : item.sourceUrl; }
function siteLabel(site) { return ({ leilo: 'Leilo', vipleiloes: 'VIP Leilões', superbid: 'Superbid', francoleiloes: 'Franco Leilões', alessandroteixeira: 'Alessandro Teixeira Leilões', alvaroleiloes: 'Álvaro Leilões', brunoleiloes: 'Bruno Leilões', calilleiloes: 'Calil Leilões', capitalvalorleiloes: 'Capital Valor Leilões', d1lance: 'D1 Lance' })[site] || site || ''; }
function areaLabel(value) { return value == null || value === '' ? '-' : `${number(value)} m²`; }
function documentTypeLabel(type) { return ({ matricula: 'Matrícula', edital: 'Edital', condicoes: 'Condições', laudo: 'Laudo', outro: 'Documento' })[type] || ''; }
function assetTypeLabel(value) { return ({ car: 'Carro', motorcycle: 'Moto', heavy: 'Pesado', real_estate: 'Imóvel' })[value] || 'Bem'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function escapeAttr(value) { return escapeHtml(value); }
