/**
 * Background Service Worker - Totleads LK
 * Orchestre l'extraction des leads en arrière-plan
 */

// Importer l'API client
importScripts('utils/api-client.js');
// Importer la config pour le service webhook
importScripts('config/config.js');
// Importer le service webhook
importScripts('services/webhook-service.js');

// ============================================================================
// CONFIGURATION ET CONSTANTES
// ============================================================================

const BACKGROUND_CONFIG = {
  DEFAULT_MAX_LEADS: 50,
  PAGE_LOAD_DELAY: 4000,
  RETRY_DELAY: 5000,
  PAGE_RETRY_LIMIT: 1,
  NEXT_BUTTON_RETRY_LIMIT: 1,
  BULK_PAGE_READY_DELAY: 2000,
  BULK_NAVIGATION_TIMEOUT: 45000,
  BULK_BETWEEN_URL_DELAY: 5000,
  // URL de l'API - doit correspondre à config.js
  API_BASE_URL: self.TotleadsConfig?.API_BASE_URL || 'https://app.totleads.com',
};

// Exposer CONFIG globalement pour que api-client.js puisse y accéder (compatibilité)
self.CONFIG = BACKGROUND_CONFIG;

// Exposer la config pour le service webhook (si config.js est chargé)
if (typeof config !== 'undefined') {
  self.TotleadsConfig = config;
}

// Nettoyage au démarrage : supprimer les anciennes données apiData du localStorage
// pour nettoyer les versions précédentes de l'extension
chrome.storage.local.remove(['apiData']).catch(() => {
  // Erreur silencieuse
});

// Logger centralisé (configurable via config.js)
const logger = self.TotleadsLogger || {
  debug: () => { },
  info: () => { },
  warn: () => { },
  error: () => { },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let offscreenDocumentCreation = null;

async function hasOffscreenDocument() {
  if (!chrome.offscreen) return false;
  if (typeof chrome.offscreen.hasDocument === 'function') {
    return chrome.offscreen.hasDocument();
  }

  if (typeof clients !== 'undefined' && typeof clients.matchAll === 'function') {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    const extensionClients = await clients.matchAll();
    return extensionClients.some(client => client.url === offscreenUrl);
  }

  return false;
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) return false;
  if (await hasOffscreenDocument()) return true;

  if (!offscreenDocumentCreation) {
    offscreenDocumentCreation = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play an audible alert when an extraction needs user attention.'
    }).finally(() => {
      offscreenDocumentCreation = null;
    });
  }

  await offscreenDocumentCreation;
  return true;
}

async function playExtractionErrorAlert(tabId = null) {
  try {
    if (await ensureOffscreenDocument()) {
      let lastSoundError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await chrome.runtime.sendMessage({
            target: 'totleads-offscreen',
            action: 'PLAY_EXTRACTION_ERROR_SOUND'
          });
          return;
        } catch (error) {
          lastSoundError = error;
          if (attempt === 0) await sleep(100);
        }
      }
      throw lastSoundError;
    }
  } catch (error) {
    logger.warn('[Background] Offscreen error sound unavailable', error);
  }

  // Fallback for Chrome versions without the offscreen API.
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'playExtractionErrorSound'
      });
    } catch (error) {
      // The tab may be closed; error alerts must never break the queue state.
    }
  }
}

async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const attempts = retryOptions.attempts || 2;
  const retryDelay = retryOptions.delay || 700;
  const retryStatuses = retryOptions.retryStatuses || [408, 429, 500, 502, 503, 504];
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!retryStatuses.includes(response.status) || attempt === attempts) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        throw error;
      }
    }

    await sleep(retryDelay * attempt);
  }

  throw lastError || new Error('Erreur réseau');
}

function getTextSizeBytes(text) {
  try {
    return new TextEncoder().encode(text || '').length;
  } catch (error) {
    return (text || '').length;
  }
}

function getCsvRowsCount(csvContent) {
  if (!csvContent || typeof csvContent !== 'string') {
    return 0;
  }

  return Math.max(csvContent.split('\n').length - 1, 0);
}

function extractApiErrorMessage(errorText, fallbackMessage) {
  let errorMessage = fallbackMessage;

  try {
    const errorData = JSON.parse(errorText);
    const baseMessage = errorData.error || errorData.message || errorText || fallbackMessage;
    const validationMessages = [];

    if (errorData.errors && typeof errorData.errors === 'object') {
      Object.values(errorData.errors).forEach(value => {
        if (Array.isArray(value)) {
          validationMessages.push(...value);
        } else if (value && typeof value === 'object') {
          Object.values(value).forEach(nestedValue => {
            if (Array.isArray(nestedValue)) {
              validationMessages.push(...nestedValue);
            } else if (nestedValue) {
              validationMessages.push(String(nestedValue));
            }
          });
        } else if (value) {
          validationMessages.push(String(value));
        }
      });
    }

    errorMessage = validationMessages.length > 0
      ? `${baseMessage}: ${validationMessages.join(' ')}`
      : baseMessage;
  } catch (parseError) {
    errorMessage = errorText || fallbackMessage;
  }

  return errorMessage;
}

// ============================================================================
// GESTION DU STOCKAGE DES LISTES
// ============================================================================

/**
 * Sauvegarde les listes capturées dans le storage local
 * @param {Object} data - Données des listes à sauvegarder
 */
async function saveListsData(data) {
  try {
    const listsData = {
      lists: data.lists,
      listsCount: data.listsCount,
      timestamp: data.timestamp || Date.now()
    };

    await chrome.storage.local.set({ listsData: listsData });
  } catch (error) {
    // Erreur silencieuse
  }
}

/**
 * Récupère les listes capturées
 * @returns {Promise<Object>} - Données des listes
 */
async function getListsData() {
  try {
    const result = await chrome.storage.local.get(['listsData']);
    return result.listsData || null;
  } catch (error) {
    return null;
  }
}

/**
 * Vide les listes capturées
 */
async function clearListsData() {
  try {
    await chrome.storage.local.remove(['listsData']);
  } catch (error) {
    // Erreur silencieuse
  }
}

// ============================================================================
// GESTION DU MEMBER URN LINKEDIN
// ============================================================================

/**
 * Récupère le member URN LinkedIn depuis le storage
 * @returns {Promise<string|null>} - Member URN ou null
 */
async function getLinkedInMemberUrn() {
  try {
    const result = await chrome.storage.local.get(['linkedinMemberUrn']);
    const memberUrn = result.linkedinMemberUrn || null;

    return memberUrn;
  } catch (error) {
    return null;
  }
}

/**
 * Récupère le slug LinkedIn depuis le storage
 * @returns {Promise<string|null>} - Slug ou null
 */
async function getLinkedInSlug() {
  try {
    const result = await chrome.storage.local.get(['slugLK']);
    return result.slugLK || null;
  } catch (error) {
    return null;
  }
}

// ============================================================================
// GESTION DE L'ÉTAT DU TRAITEMENT EN ARRIÈRE-PLAN
// ============================================================================

let backgroundProcessState = {
  isRunning: false,
  runId: null,
  tabId: null,
  currentPage: 1,
  collectedLeads: [],
  collectedUrns: new Set(), // Utiliser un Set pour O(1) lookup
  duplicatePagesMap: new Map(), // Map<objectUrn, number[]> - Track les pages où chaque lead apparaît
  maxLeads: BACKGROUND_CONFIG.DEFAULT_MAX_LEADS,
  startTime: null,
  lastCollectTimestamp: 0,
  duplicatesRemoved: 0, // Nombre de doublons retirés
  filters: null, // Filters de la recherche (metadata.filters)
  dataType: 'lead', // Type de données: 'lead' ou 'account'
  stopReason: null, // Raison de l'arrêt: 'limit_reached', 'no_more_pages', 'api_timeout', 'tab_closed', 'error'
  pageRetryCount: 0,
  failureDetails: null,
  bulkContext: null,
  pauseRequested: false,
  isFinishing: false,
  resumePhase: 'collect_current_page',
  lastPageLeadCount: 0,
  reportedTotal: null,
  captureCurrentPageWithoutTimestamp: false,
  reloadedForResume: false
};

let nextBackgroundRunId = 1;

function isCurrentBackgroundRun(runId) {
  return backgroundProcessState.isRunning && backgroundProcessState.runId === runId;
}

/**
 * Démarre le traitement de pagination en arrière-plan
 * @param {number} tabId - ID de l'onglet LinkedIn
 * @param {number} maxLeads - Nombre maximum de leads/accounts à collecter
 * @param {string} dataType - Type de données ('lead' ou 'account')
 * @param {boolean} [addToList] - Si true, ajouter chaque page à la liste sélectionnée
 * @param {string|null} [listName] - Nom de la liste cible (si addToList)
 * @param {Object|null} [bulkContext] - Position de l'URL pour une extraction en lot
 * @returns {Promise<Object>} - Résultat du démarrage
 */
async function startBackgroundPagination(
  tabId,
  maxLeads = BACKGROUND_CONFIG.DEFAULT_MAX_LEADS,
  dataType = 'lead',
  addToList = false,
  listName = null,
  bulkContext = null
) {
  if (backgroundProcessState.isRunning) {
    return { success: false, error: 'Un traitement est déjà en cours' };
  }

  const runId = nextBackgroundRunId++;

  // Réinitialiser l'état
  backgroundProcessState = {
    isRunning: true,
    runId,
    tabId: tabId,
    currentPage: 1,
    collectedLeads: [],
    collectedUrns: new Set(),
    duplicatePagesMap: new Map(), // Map<objectUrn, number[]> - Track les pages où chaque lead apparaît
    maxLeads: maxLeads,
    startTime: Date.now(),
    lastCollectTimestamp: 0,
    duplicatesRemoved: 0, // Nombre de doublons retirés
    filters: null, // Filters de la recherche (metadata.filters)
    dataType: dataType, // Type de données: 'lead' ou 'account'
    stopReason: null, // Raison de l'arrêt
    addToList: addToList === true && listName,
    listName: listName || null,
    pageRetryCount: 0,
    failureDetails: null,
    bulkContext: bulkContext,
    pauseRequested: false,
    isFinishing: false,
    resumePhase: 'collect_current_page',
    lastPageLeadCount: 0,
    reportedTotal: null,
    captureCurrentPageWithoutTimestamp: false,
    reloadedForResume: false
  };

  try {
    await processNextPage(runId);
    return {
      success: backgroundProcessState.runId === runId && backgroundProcessState.stopReason !== config.STOP_REASONS.CUT_TAB_CLOSED,
      stopReason: backgroundProcessState.runId === runId ? backgroundProcessState.stopReason : null
    };
  } catch (error) {
    if (backgroundProcessState.runId === runId) {
      backgroundProcessState.isRunning = false;
    }
    return { success: false, error: error.message };
  }
}

function normalizeBulkCheckpointPageUrl(url, currentPage) {
  try {
    const parsedUrl = new URL(url);
    if (
      !parsedUrl.hostname.endsWith('linkedin.com') ||
      !parsedUrl.pathname.includes('/sales/search/')
    ) {
      return url;
    }

    const page = String(Math.max(1, Number(currentPage) || 1));
    if (/[?&]page=[^&#]*/i.test(url)) {
      return url.replace(/([?&])page=[^&#]*/i, `$1page=${page}`);
    }

    const hashIndex = url.indexOf('#');
    const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    const separator = beforeHash.includes('?')
      ? (beforeHash.endsWith('?') || beforeHash.endsWith('&') ? '' : '&')
      : '?';
    return `${beforeHash}${separator}page=${page}${hash}`;
  } catch (error) {
    return url;
  }
}

async function buildBulkScrapeCheckpoint(state = backgroundProcessState) {
  let pageUrl = normalizeBulkCheckpointPageUrl(
    state.bulkContext.url,
    state.currentPage
  );
  try {
    const tab = await chrome.tabs.get(state.tabId);
    if (tab?.url?.includes('linkedin.com/sales/search/')) {
      pageUrl = normalizeBulkCheckpointPageUrl(tab.url, state.currentPage);
    }
  } catch (error) {
    // The URL reconstructed from the bulk search and page number is durable
    // even when the original tab has already been closed.
  }

  return {
    version: 1,
    urlIndex: state.bulkContext.urlIndex,
    urlNumber: state.bulkContext.urlNumber,
    totalUrls: state.bulkContext.totalUrls,
    url: state.bulkContext.url,
    pageUrl,
    currentPage: state.currentPage,
    collectedLeads: state.collectedLeads,
    collectedUrns: Array.from(state.collectedUrns),
    duplicatePages: Array.from(state.duplicatePagesMap.entries()),
    maxLeads: state.maxLeads,
    dataType: state.dataType,
    filters: state.filters,
    duplicatesRemoved: state.duplicatesRemoved,
    addToList: state.addToList,
    listName: state.listName,
    resumePhase: state.resumePhase || 'collect_current_page',
    lastPageLeadCount: state.lastPageLeadCount || 0,
    reportedTotal: Number.isFinite(state.reportedTotal) ? state.reportedTotal : null,
    startTime: state.startTime,
    savedAt: Date.now()
  };
}

async function persistBulkScrapeCheckpoint(state = backgroundProcessState) {
  const checkpoint = await buildBulkScrapeCheckpoint(state);
  await chrome.storage.local.set({ bulkScrapeCheckpoint: checkpoint });
  return checkpoint;
}

async function pauseBackgroundRunAtSafePoint(runId) {
  if (
    !isCurrentBackgroundRun(runId) ||
    !backgroundProcessState.bulkContext ||
    !backgroundProcessState.pauseRequested
  ) {
    return false;
  }

  const state = backgroundProcessState;
  let checkpoint;

  try {
    checkpoint = await persistBulkScrapeCheckpoint(state);
  } catch (error) {
    state.isRunning = false;
    state.pauseRequested = false;
    bulkScrapeState.isActive = false;
    bulkScrapeState.isPaused = false;
    bulkScrapeState.isPausing = false;
    bulkScrapeState.lastError = {
      reason: 'checkpoint_save_failed',
      message: `Pause failed because progress could not be saved: ${error.message || error}`,
      urlIndex: state.bulkContext.urlIndex,
      urlNumber: state.bulkContext.urlNumber,
      url: state.bulkContext.url,
      collectedCount: state.collectedLeads.length,
      timestamp: Date.now()
    };
    await saveBulkState();
    void playExtractionErrorAlert(state.tabId);
    return false;
  }

  state.isRunning = false;
  state.pauseRequested = false;
  state.collectedLeads = [];
  state.collectedUrns.clear();
  state.duplicatePagesMap.clear();

  bulkScrapeState.isActive = false;
  bulkScrapeState.isPaused = true;
  bulkScrapeState.isPausing = false;
  bulkScrapeState.lastError = null;
  bulkScrapeState.pausedProgress = {
    currentPage: checkpoint.currentPage,
    collectedCount: checkpoint.collectedLeads.length,
    resumePhase: checkpoint.resumePhase,
    savedAt: checkpoint.savedAt
  };
  await saveBulkState();
  logger.info('[BulkScrape] Paused with checkpoint', bulkScrapeState.pausedProgress);
  return true;
}

async function continueAfterCollectedPage(runId) {
  if (!isCurrentBackgroundRun(runId)) return;
  if (backgroundProcessState.pauseRequested) {
    await pauseBackgroundRunAtSafePoint(runId);
    return;
  }

  const {
    tabId,
    maxLeads,
    collectedLeads,
    currentPage,
    lastPageLeadCount
  } = backgroundProcessState;
  const totalCollected = collectedLeads.length;
  const reportedTotal = Number(backgroundProcessState.reportedTotal);
  const hasReportedTotal = Number.isFinite(reportedTotal) && reportedTotal > 0;

  if (totalCollected >= maxLeads) {
    backgroundProcessState.stopReason = config.STOP_REASONS.COMPLETE_MAX_REACHED;
    await finishBackgroundProcess(runId);
    return;
  }

  if (hasReportedTotal && totalCollected >= reportedTotal) {
    backgroundProcessState.stopReason = config.STOP_REASONS.COMPLETE_ALL_RESULTS;
    await finishBackgroundProcess(runId);
    return;
  }

  if (backgroundProcessState.reloadedForResume) {
    // Ignore the API response caused by reloading the already-collected page.
    backgroundProcessState.lastCollectTimestamp = Date.now();
    backgroundProcessState.reloadedForResume = false;
  }

  let navResponse = null;
  for (let attempt = 0; attempt <= BACKGROUND_CONFIG.NEXT_BUTTON_RETRY_LIMIT; attempt += 1) {
    if (backgroundProcessState.pauseRequested) {
      await pauseBackgroundRunAtSafePoint(runId);
      return;
    }

    navResponse = await chrome.tabs.sendMessage(tabId, {
      action: 'goToNextPage'
    });

    if (!isCurrentBackgroundRun(runId)) return;

    if (navResponse?.success || navResponse?.reason !== 'next_button_missing') {
      break;
    }

    if (attempt < BACKGROUND_CONFIG.NEXT_BUTTON_RETRY_LIMIT) {
      if (backgroundProcessState.pauseRequested) {
        await pauseBackgroundRunAtSafePoint(runId);
        return;
      }
      await sleep(BACKGROUND_CONFIG.RETRY_DELAY);
    }
  }

  if (!isCurrentBackgroundRun(runId)) return;

  if (navResponse?.success) {
    backgroundProcessState.currentPage++;
    backgroundProcessState.resumePhase = 'collect_current_page';
    backgroundProcessState.captureCurrentPageWithoutTimestamp = false;

    if (backgroundProcessState.pauseRequested) {
      await pauseBackgroundRunAtSafePoint(runId);
      return;
    }

    setTimeout(() => processNextPage(runId), BACKGROUND_CONFIG.PAGE_LOAD_DELAY);
    return;
  }

  if (backgroundProcessState.pauseRequested) {
    await pauseBackgroundRunAtSafePoint(runId);
    return;
  }

  const nextButtonMissing = navResponse?.reason === 'next_button_missing';
  const apiReportsMoreResults = hasReportedTotal && reportedTotal > totalCollected;
  const shortFinalPage = !apiReportsMoreResults &&
    lastPageLeadCount < (config.LEADS_PER_PAGE || 25);
  const unexpectedMissingButton = nextButtonMissing && !shortFinalPage;

  backgroundProcessState.stopReason = unexpectedMissingButton
    ? config.STOP_REASONS.CUT_NEXT_BUTTON_MISSING
    : config.STOP_REASONS.COMPLETE_ALL_RESULTS;
  if (unexpectedMissingButton) {
    backgroundProcessState.failureDetails = {
      reason: 'next_button_missing',
      message: navResponse?.error || 'The Next button could not be found',
      page: currentPage
    };
  }
  await finishBackgroundProcess(runId);
}

/**
 * Traite la page suivante de manière récursive
 */
async function processNextPage(runId = backgroundProcessState.runId) {
  if (!isCurrentBackgroundRun(runId)) {
    return;
  }

  if (backgroundProcessState.pauseRequested) {
    await pauseBackgroundRunAtSafePoint(runId);
    return;
  }

  if (backgroundProcessState.resumePhase === 'navigate_next_page') {
    await continueAfterCollectedPage(runId);
    return;
  }

  const { tabId, currentPage, collectedLeads, collectedUrns, maxLeads } = backgroundProcessState;

  // Vérifier si on a atteint la limite
  if (collectedLeads.length >= maxLeads) {
    backgroundProcessState.stopReason = config.STOP_REASONS.COMPLETE_MAX_REACHED;
    await finishBackgroundProcess(runId);
    return;
  }

  try {
    // Pour la première page, utiliser timestamp 0 pour capturer toutes les données existantes
    // Pour les pages suivantes, utiliser le timestamp fixé après la collecte précédente
    const afterTimestamp = currentPage === 1 || backgroundProcessState.captureCurrentPageWithoutTimestamp
      ? 0
      : backgroundProcessState.lastCollectTimestamp;

    // Demander au content script de collecter les leads/accounts
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'collectCurrentPage',
      afterTimestamp: afterTimestamp,
      dataType: backgroundProcessState.dataType
    });

    if (!isCurrentBackgroundRun(runId)) {
      return;
    }

    if (backgroundProcessState.pauseRequested) {
      await pauseBackgroundRunAtSafePoint(runId);
      return;
    }

    if (response?.success && response.leads?.length > 0) {
      backgroundProcessState.pageRetryCount = 0;
      backgroundProcessState.failureDetails = null;
      backgroundProcessState.captureCurrentPageWithoutTimestamp = false;

      // Fixer le timestamp APRÈS la collecte réussie pour marquer le point de référence
      // pour la prochaine page
      backgroundProcessState.lastCollectTimestamp = Date.now();

      // Extraire et stocker les filters depuis metadata (les filters sont identiques pour une recherche donnée)
      if (response.metadata && response.metadata.filters) {
        backgroundProcessState.filters = response.metadata.filters;
      }

      // Tracker les doublons avec leurs pages de présence
      const { duplicatePagesMap } = backgroundProcessState;

      // Pour chaque lead/account reçu, tracker sa présence sur la page actuelle
      // Utiliser entityUrn pour accounts, objectUrn pour leads
      const urnField = backgroundProcessState.dataType === 'account' ? 'entityUrn' : 'objectUrn';
      
      response.leads.forEach(lead => {
        const urn = lead[urnField];
        if (urn) {
          if (duplicatePagesMap.has(urn)) {
            // Lead/account déjà vu, ajouter la page actuelle
            const pages = duplicatePagesMap.get(urn);
            if (!pages.includes(currentPage)) {
              pages.push(currentPage);
            }
          } else {
            // Nouveau lead/account, créer l'entrée avec la page actuelle
            duplicatePagesMap.set(urn, [currentPage]);
          }
        }
      });

      // Filtrer les doublons avec le Set (O(1))
      const newLeads = response.leads.filter(lead => {
        const urn = lead[urnField];
        if (urn && !collectedUrns.has(urn)) {
          collectedUrns.add(urn);
          return true;
        }
        return false;
      });

      // Ajouter les leads (limités au max)
      const leadsToAdd = newLeads.slice(0, maxLeads - collectedLeads.length);
      backgroundProcessState.collectedLeads.push(...leadsToAdd);
      backgroundProcessState.resumePhase = 'navigate_next_page';
      backgroundProcessState.lastPageLeadCount = response.leads.length;
      const responseTotal = Number(response.paging?.total);
      backgroundProcessState.reportedTotal = Number.isFinite(responseTotal) && responseTotal > 0
        ? responseTotal
        : null;

      const duplicates = response.leads.length - newLeads.length;

      // Logger les doublons détectés sur cette page
      if (duplicates > 0) {
        const duplicatesOnThisPage = response.leads.filter(lead =>
          lead.objectUrn && collectedUrns.has(lead.objectUrn)
        );
        const duplicateInfo = {};
        duplicatesOnThisPage.forEach(lead => {
          if (lead.objectUrn && lead.fullName) {
            const pages = duplicatePagesMap.get(lead.objectUrn);
            duplicateInfo[lead.fullName] = pages;
          }
        });
        logger.info('[Background] Doublons détectés sur la page', {
          page: currentPage,
          count: duplicates,
          duplicates: duplicateInfo
        });
      }

      // Si option "ajouter à une liste", appeler le content script pour la page courante
      if (backgroundProcessState.addToList && backgroundProcessState.listName) {
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: 'addCurrentPageToList',
            listName: backgroundProcessState.listName
          });
        } catch (addListError) {
          logger.warn('[Background] addCurrentPageToList failed (continuing CSV export)', addListError);
        }
      }

      if (!isCurrentBackgroundRun(runId)) {
        return;
      }

      if (backgroundProcessState.pauseRequested) {
        await pauseBackgroundRunAtSafePoint(runId);
        return;
      }

      await continueAfterCollectedPage(runId);
    } else {
      const failureReason = response?.reason || 'api_timeout';
      const isRetryable = failureReason === 'api_timeout' || failureReason === 'collection_error';

      if (isRetryable && backgroundProcessState.pageRetryCount < BACKGROUND_CONFIG.PAGE_RETRY_LIMIT) {
        backgroundProcessState.pageRetryCount++;
        logger.warn('[Background] Page collection failed; retrying once', {
          page: currentPage,
          reason: failureReason
        });
        setTimeout(() => processNextPage(runId), BACKGROUND_CONFIG.RETRY_DELAY);
        return;
      }

      if (failureReason === 'api_error') {
        backgroundProcessState.stopReason = config.STOP_REASONS.CUT_API_ERROR;
      } else if (failureReason === 'empty_results') {
        backgroundProcessState.stopReason = config.STOP_REASONS.CUT_EMPTY_RESULTS;
      } else {
        backgroundProcessState.stopReason = currentPage === 1
          ? config.STOP_REASONS.CUT_NO_RESULTS_FIRST_PAGE
          : config.STOP_REASONS.CUT_API_TIMEOUT;
      }

      backgroundProcessState.failureDetails = {
        reason: failureReason,
        message: response?.apiError?.message || response?.error || (
          failureReason === 'empty_results'
            ? 'LinkedIn returned zero results'
            : 'No fresh LinkedIn search data was received before the timeout'
        ),
        status: response?.apiError?.status ?? response?.statusCode ?? null,
        kind: response?.apiError?.kind || null,
        page: currentPage
      };
      await finishBackgroundProcess(runId);
    }
  } catch (error) {
    if (!isCurrentBackgroundRun(runId)) {
      return;
    }

    if (backgroundProcessState.pauseRequested) {
      await pauseBackgroundRunAtSafePoint(runId);
      return;
    }

    // Si l'onglet est fermé
    const connectionLost = error.message?.includes('Could not establish connection') ||
      error.message?.includes('Receiving end does not exist') ||
      error.message?.includes('No tab with id');

    if (connectionLost) {
      backgroundProcessState.stopReason = config.STOP_REASONS.CUT_TAB_CLOSED;
      backgroundProcessState.failureDetails = {
        reason: 'tab_connection_lost',
        message: error.message,
        page: backgroundProcessState.currentPage
      };
      await finishBackgroundProcess(runId);
    } else if (backgroundProcessState.pageRetryCount < BACKGROUND_CONFIG.PAGE_RETRY_LIMIT) {
      backgroundProcessState.pageRetryCount++;
      setTimeout(() => processNextPage(runId), BACKGROUND_CONFIG.RETRY_DELAY);
    } else {
      backgroundProcessState.stopReason = config.STOP_REASONS.CUT_ERROR;
      backgroundProcessState.failureDetails = {
        reason: 'unexpected_error',
        message: error.message || String(error),
        page: backgroundProcessState.currentPage
      };
      await finishBackgroundProcess(runId);
    }
  }
}

/**
 * Termine le traitement et génère le CSV
 */
async function finishBackgroundProcess(runId = backgroundProcessState.runId) {
  if (!isCurrentBackgroundRun(runId)) {
    return;
  }

  if (backgroundProcessState.pauseRequested && backgroundProcessState.bulkContext) {
    await pauseBackgroundRunAtSafePoint(runId);
    return;
  }

  backgroundProcessState.isFinishing = true;

  const {
    tabId,
    collectedLeads,
    duplicatePagesMap,
    maxLeads,
    dataType,
    stopReason,
    failureDetails,
    bulkContext
  } = backgroundProcessState;
  const isNormalCompletion = stopReason === config.STOP_REASONS.COMPLETE_MAX_REACHED ||
    stopReason === config.STOP_REASONS.COMPLETE_ALL_RESULTS;
  const isBulkRun = Boolean(
    bulkContext &&
    Number.isInteger(bulkContext.urlIndex) &&
    Number.isInteger(bulkContext.urlNumber)
  );

  // Calculer le total de doublons retirés (leads qui apparaissent sur plusieurs pages)
  let duplicatesRemoved = 0;
  const duplicateDetails = {};

  // Utiliser le bon champ URN selon le type
  const urnField = dataType === 'account' ? 'entityUrn' : 'objectUrn';
  
  duplicatePagesMap.forEach((pages, urn) => {
    if (pages.length > 1) {
      duplicatesRemoved++;
      // Trouver le nom du lead/account pour le logging
      const item = collectedLeads.find(l => l[urnField] === urn);
      if (item) {
        const name = dataType === 'account' ? item.companyName : item.fullName;
        if (name) {
          duplicateDetails[name] = pages;
        } else {
          duplicateDetails[urn] = pages;
        }
      } else {
        duplicateDetails[urn] = pages;
      }
    }
  });

  // Logger tous les doublons détectés
  if (duplicatesRemoved > 0) {
    logger.info('[Background] Doublons détectés', {
      totalDuplicatesRemoved: duplicatesRemoved,
      duplicateMap: duplicateDetails
    });
  }
  logger.info('[Background] Total doublons retirés', { count: duplicatesRemoved });

  // Stocker le nombre de doublons dans backgroundProcessState pour l'upload CSV
  backgroundProcessState.duplicatesRemoved = duplicatesRemoved;

  let uploadSucceeded = false;
  let uploadError = null;

  // Ne jamais créer/uploader un CSV vide. Une page 1 sans données est ambiguë
  // (vraie recherche vide, limitation, challenge ou interception cassée).
  if (collectedLeads.length === 0) {
    uploadError = failureDetails?.message || 'No LinkedIn data was collected; no blank CSV was created.';
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'showUploadError',
        error: uploadError
      });
    } catch (msgError) {
      // L'onglet peut être fermé ou en cours de navigation.
    }
  } else {
    // Demander au content script de générer et uploader le CSV.
    // Lors d'un arrêt anormal après plusieurs pages, ce CSV contient les données
    // partielles déjà collectées, mais le bulk reste en pause sur la même URL.
    try {
      const uploadResult = await chrome.tabs.sendMessage(tabId, {
        action: 'generateAndUploadCSV',
        leads: collectedLeads,
        maxLeads: maxLeads,
        dataType: dataType,
        bulkContext: isBulkRun ? bulkContext : null
      });

      if (backgroundProcessState.runId !== runId) {
        return;
      }

      if (uploadResult?.success) {
        uploadSucceeded = true;
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: 'showUploadSuccess',
            data: {
              ...(uploadResult.data || {}),
              duplicatesRemoved: duplicatesRemoved,
              partial: !isNormalCompletion,
              filename: uploadResult.filename
            }
          });
        } catch (msgError) {
          // L'upload a réussi même si la notification UI n'a pas pu être affichée.
        }
      } else {
        uploadError = uploadResult?.error || 'Erreur inconnue lors de l\'upload';
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: 'showUploadError',
            error: uploadError
          });
        } catch (msgError) {
          // Erreur silencieuse
        }
      }
    } catch (error) {
      if (backgroundProcessState.runId !== runId) {
        return;
      }

      uploadError = error.message || 'Erreur lors de l\'upload du CSV';
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'showUploadError',
          error: uploadError
        });
      } catch (msgError) {
        // Erreur silencieuse
      }
    }
  }

  // An incomplete bulk URL must remain resumable even after its partial CSV is
  // exported. Persist the accumulated rows and exact page before clearing the
  // in-memory run. This also covers a completed scrape whose final upload failed.
  let resumableCheckpoint = null;
  let checkpointSaveError = null;
  const shouldPreserveCheckpoint = isBulkRun &&
    collectedLeads.length > 0 &&
    (!isNormalCompletion || !uploadSucceeded);
  if (shouldPreserveCheckpoint) {
    try {
      resumableCheckpoint = await persistBulkScrapeCheckpoint(backgroundProcessState);
    } catch (error) {
      checkpointSaveError = error;
      logger.error('[BulkScrape] Failed to preserve error checkpoint', error);

      // A checkpoint from an earlier resume point is still safer than
      // restarting the URL from page 1.
      try {
        const stored = await chrome.storage.local.get(['bulkScrapeCheckpoint']);
        if (isCheckpointForBulkPosition(stored.bulkScrapeCheckpoint)) {
          resumableCheckpoint = stored.bulkScrapeCheckpoint;
        }
      } catch (storageError) {
        // The original extraction error remains the primary UI error.
      }
    }
  }

  // Réinitialiser l'état
  if (backgroundProcessState.runId === runId) {
    backgroundProcessState.isFinishing = false;
    backgroundProcessState.isRunning = false;
    backgroundProcessState.collectedLeads = [];
    backgroundProcessState.collectedUrns.clear();
    backgroundProcessState.duplicatePagesMap.clear();

    if (isBulkRun && typeof bulkScrapeState !== 'undefined') {
      const sameBulkUrl = bulkScrapeState.currentIndex === bulkContext.urlIndex;
      const canAdvance = bulkScrapeState.isActive &&
        sameBulkUrl &&
        isNormalCompletion &&
        uploadSucceeded;

      if (canAdvance) {
        chrome.storage.local.remove(['bulkScrapeCheckpoint']).catch(() => {});
        bulkScrapeState.currentIndex++;
        bulkScrapeState.lastError = null;
        bulkScrapeState.isPaused = false;
        bulkScrapeState.isPausing = false;
        bulkScrapeState.pausedProgress = null;
        if (typeof saveBulkState === 'function') saveBulkState();
        setTimeout(() => {
          if (typeof processNextBulkUrl === 'function') processNextBulkUrl();
        }, BACKGROUND_CONFIG.BULK_BETWEEN_URL_DELAY);
      } else if (bulkScrapeState.isActive && sameBulkUrl) {
        bulkScrapeState.isActive = false;
        bulkScrapeState.isPaused = Boolean(resumableCheckpoint);
        bulkScrapeState.isPausing = false;
        bulkScrapeState.pausedProgress = resumableCheckpoint
          ? {
            currentPage: resumableCheckpoint.currentPage,
            collectedCount: resumableCheckpoint.collectedLeads.length,
            resumePhase: resumableCheckpoint.resumePhase,
            savedAt: resumableCheckpoint.savedAt
          }
          : null;
        if (!resumableCheckpoint && !checkpointSaveError) {
          chrome.storage.local.remove(['bulkScrapeCheckpoint']).catch(() => {});
        }
        bulkScrapeState.lastError = {
          reason: collectedLeads.length > 0 && uploadError
            ? 'upload_failed'
            : (failureDetails?.reason || stopReason || 'incomplete'),
          message: uploadError || failureDetails?.message || 'The URL did not complete normally.',
          status: failureDetails?.status ?? null,
          page: failureDetails?.page || backgroundProcessState.currentPage,
          urlIndex: bulkContext.urlIndex,
          urlNumber: bulkContext.urlNumber,
          url: bulkContext.url,
          collectedCount: collectedLeads.length,
          partialExported: uploadSucceeded,
          resumeAvailable: Boolean(resumableCheckpoint),
          checkpointPage: resumableCheckpoint?.currentPage || null,
          checkpointSaveError: checkpointSaveError?.message || null,
          timestamp: Date.now()
        };
        if (typeof saveBulkState === 'function') saveBulkState();
        logger.warn('[BulkScrape] Paused on incomplete URL', bulkScrapeState.lastError);
      }
    }

    const shouldPlayErrorAlert = stopReason !== config.STOP_REASONS.CUT_USER_STOPPED &&
      (!isNormalCompletion || !uploadSucceeded);
    if (shouldPlayErrorAlert) {
      void playExtractionErrorAlert(tabId);
    }
  }
}

/**
 * Arrête le traitement en cours (sans nettoyer les leads collectés)
 * @returns {Object} - Résultat de l'arrêt
 */
function stopBackgroundPagination() {
  if (backgroundProcessState.isRunning) {
    const tabId = backgroundProcessState.tabId;
    backgroundProcessState.isRunning = false;

    // Notifier le content script pour nettoyer les promesses en attente
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: 'clearPendingPromises'
      }).catch(() => {
        // Erreur silencieuse (onglet peut être fermé)
      });
    }

    return { success: true, message: 'Traitement arrêté' };
  }
  return { success: false, message: 'Aucun traitement en cours' };
}

/**
 * Arrête le traitement et retourne les leads/accounts collectés
 * @returns {Object} - Résultat avec les leads/accounts collectés
 */
function stopAndReturnLeads() {
  if (backgroundProcessState.isRunning) {
    backgroundProcessState.isRunning = false;
    backgroundProcessState.stopReason = config.STOP_REASONS.CUT_USER_STOPPED;

    return {
      success: true,
      message: 'Traitement arrêté',
      leads: backgroundProcessState.collectedLeads,
      leadsCount: backgroundProcessState.collectedLeads.length,
      currentPage: backgroundProcessState.currentPage,
      tabId: backgroundProcessState.tabId,
      dataType: backgroundProcessState.dataType
    };
  }
  return {
    success: false,
    message: 'Aucun traitement en cours',
    leads: [],
    leadsCount: 0,
    dataType: 'lead'
  };
}

/**
 * Annule complètement l'extraction et nettoie les données
 * @returns {Object} - Résultat de l'annulation
 */
function cancelExtraction() {
  const tabId = backgroundProcessState.tabId;

  backgroundProcessState.isRunning = false;
  backgroundProcessState.collectedLeads = [];
  backgroundProcessState.collectedUrns.clear();
  backgroundProcessState.duplicatePagesMap.clear();
  backgroundProcessState.duplicatesRemoved = 0;
  backgroundProcessState.stopReason = null;
  backgroundProcessState.tabId = null;
  backgroundProcessState.currentPage = 1;

  // Notifier le content script pour nettoyer les promesses en attente
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'clearPendingPromises'
    }).catch(() => {
      // Erreur silencieuse (onglet peut être fermé)
    });
  }

  return {
    success: true,
    message: 'Extraction annulée et données nettoyées'
  };
}

/**
 * Retourne l'état actuel du traitement
 * @returns {Object} - État du traitement
 */
function getBackgroundProcessState() {
  return {
    isRunning: backgroundProcessState.isRunning,
    currentPage: backgroundProcessState.currentPage,
    leadsCollected: backgroundProcessState.collectedLeads.length,
    maxLeads: backgroundProcessState.maxLeads
  };
}

// ============================================================================
// GESTION DES VISITES SALES NAVIGATOR
// ============================================================================

/**
 * Envoie le webhook d'ouverture de Sales Nav
 */
async function sendOpenedSalesNavWebhook() {
  try {
    const webhookService = self.TotleadsWebhookService;
    if (!webhookService || !webhookService.sendOpenedSalesNavWebhookService) {
      return;
    }

    // Récupérer directement depuis le storage (null si absent pour que le payload contienne toujours les clés)
    const storageData = await chrome.storage.local.get(['linkedinMemberUrn', 'slugLK', 'linkedin_extractor_credentials']);
    const member = storageData.linkedinMemberUrn ?? null;
    const slug = storageData.slugLK ?? null;
    const credentials = storageData.linkedin_extractor_credentials || {};
    const secretKey = credentials.secretKey || null;
    // Envoyer le webhook avec member, slug et secretKey (identification fiable côté backend)
    await webhookService.sendOpenedSalesNavWebhookService(
      BACKGROUND_CONFIG.API_BASE_URL || 'https://app.totleads.com',
      member,
      slug,
      secretKey
    );
  } catch (error) {
    // Erreur silencieuse
  }
}

// ============================================================================
// GESTION DE LA DÉSINSTALLATION
// ============================================================================

/**
 * Rafraîchit le token Sanctum
 * @param {string} secretKey - Secret key pour régénérer le token
 * @returns {Promise<string|null>} - Nouveau token ou null
 */
async function refreshSanctumToken(secretKey) {
  try {
    if (!secretKey) {
      return null;
    }

    const memberUrn = await getLinkedInMemberUrn();
    const result = await validateCredentialsAPI(secretKey, memberUrn);

    if (result.valid && result.token) {
      return result.token;
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Met à jour l'URL de désinstallation avec les données actuelles
 */
async function updateUninstallURL() {
  try {
    // Récupérer les données nécessaires depuis le storage
    const storageData = await chrome.storage.local.get([
      'linkedinMemberUrn',
      'linkedin_extractor_credentials'
    ]);

    const memberUrn = storageData.linkedinMemberUrn || null;
    const credentials = storageData.linkedin_extractor_credentials || {};
    const secretKey = credentials.secretKey || null;

    // Construire l'URL avec les paramètres
    const config = self.TotleadsConfig;
    const webhookEndpoint = config?.webhooks?.EXTENSION_UNINSTALLED || '/extension/uninstalled';
    const baseUrl = BACKGROUND_CONFIG.API_BASE_URL;

    // Construire les paramètres de l'URL
    const params = new URLSearchParams();
    if (memberUrn) {
      params.append('member', memberUrn);
    }
    if (secretKey) {
      params.append('secretKey', secretKey);
    }

    const uninstallUrl = `${baseUrl}${webhookEndpoint}${params.toString() ? '?' + params.toString() : ''}`;

    // Mettre à jour l'URL de désinstallation
    chrome.runtime.setUninstallURL(uninstallUrl, () => {
      if (chrome.runtime.lastError) {
        // Erreur silencieuse
      }
    });
  } catch (error) {
    // Erreur silencieuse
  }
}

// Mettre à jour l'URL de désinstallation au démarrage
updateUninstallURL();

// Écouter les changements dans le storage pour mettre à jour l'URL
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    // Si les credentials ou le member URN changent, mettre à jour l'URL
    if (changes.linkedinMemberUrn || changes.linkedin_extractor_credentials) {
      updateUninstallURL();
    }
  }
});

// ============================================================================
// GESTIONNAIRE D'ÉVÉNEMENTS
// ============================================================================

/**
 * Gestion du clic sur l'icône de l'extension
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url?.includes('linkedin.com')) {
    return;
  }

  const config = self.TotleadsConfig;
  const url = tab.url || '';

  // Vérifier si on est sur une page de recherche d'entreprises
  const isOnCompanySearch = url.includes(config?.patterns?.SALES_SEARCH_COMPANY_URL || '/sales/search/company');

  // Vérifier si on est sur une page de recherche de leads
  const isOnPeopleSearch = url.includes(config?.patterns?.SALES_SEARCH_PEOPLE_URL || '/sales/search/people');

  // Vérifier si on est sur une page de liste de leads avec une liste sélectionnée
  // L'URL doit contenir /sales/lists/people/ suivi d'un ID (ex: /sales/lists/people/7353352459114758145)
  const listsPagePattern = /\/sales\/lists\/people\/\d+/;
  const isOnListsPage = listsPagePattern.test(url);

  // Ne rien faire si on n'est sur aucune des pages supportées
  if (!isOnCompanySearch && !isOnPeopleSearch && !isOnListsPage) {
    return;
  }

  try {
    if (isOnCompanySearch) {
      // Injecter le script de fenêtre flottante pour les accounts
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['list-floating-window.js']
      });

      // Afficher la fenêtre de liste
      await chrome.tabs.sendMessage(tab.id, { action: config?.actions?.SHOW_LIST_WINDOW || 'showListWindow' });
    } else if (isOnPeopleSearch || isOnListsPage) {
      // Injecter le script de fenêtre flottante pour les leads
      // Sur /sales/lists/people, l'extraction déclenchera "View in search" avant le flow normal
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['floating-window.js']
      });

      // Afficher la fenêtre
      await chrome.tabs.sendMessage(tab.id, { action: config?.actions?.SHOW_WINDOW || 'showWindow' });
    }
  } catch (error) {
    // Erreur silencieuse
  }
});

/**
 * Gestionnaire de messages externes depuis app.totleads.com
 * Permet au site web de détecter si l'extension est installée
 */
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  // Vérifier que la requête vient bien de app.totleads.com
  const isValidOrigin = sender.url && (
    sender.url.includes('app.totleads.com')
  );

  if (isValidOrigin) {
    // Ping de détection
    if (request.action === 'ping' || request.type === 'TOTLEADS_PING') {
      sendResponse({
        installed: true,
        version: chrome.runtime.getManifest().version,
        source: 'totleads-extension'
      });
      return true;
    }
  }

  // Message non reconnu ou origine invalide
  sendResponse({ error: 'Unknown action or invalid origin' });
  return false;
});

/**
 * Gestionnaire de messages depuis les content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Validation des credentials
  if (request.action === 'validateCredentials') {
    // Récupérer le member URN et le passer à la validation
    getLinkedInMemberUrn()
      .then(memberUrn => {
        // Utiliser le member du request s'il est fourni, sinon utiliser celui du storage
        const member = request.member || memberUrn;
        return validateCredentialsAPI(request.secretKey, member);
      })
      .then(result => {
        // Persister le token Sanctum côté background pour les flows qui lisent chrome.storage.local
        // (ex: webhook opened-sales-nav)
        if (result?.valid && result?.token) {
          chrome.storage.local.get(['linkedin_extractor_credentials'])
            .then(storageData => {
              const existing = storageData.linkedin_extractor_credentials || {};
              const merged = {
                ...existing,
                secretKey: request.secretKey,
                sanctumToken: result.token,
                sanctumTokenCreatedAt: Date.now(),
              };
              return chrome.storage.local.set({ linkedin_extractor_credentials: merged });
            })
            .catch(() => {
              // Erreur silencieuse: ne pas bloquer la validation
            });
        }
        sendResponse(result);
      })
      .catch(error => {
        sendResponse({
          valid: false,
          error: error.message || 'Erreur de connexion à l\'API',
          details: error.toString()
        });
      });
    return true;
  }

  // Liste créée à la volée (POST salesApiLists) : fusionner dans le cache
  if (request.action === 'listCreated') {
    const newList = request.list;
    if (!newList || !newList.id || !newList.name) {
      sendResponse({ success: false });
      return true;
    }
    getListsData()
      .then(existing => {
        const existingLists = existing && Array.isArray(existing.lists) ? existing.lists : [];
        const alreadyExists = existingLists.some(l => String(l.id) === String(newList.id));
        const mergedLists = alreadyExists ? existingLists : [...existingLists, newList];
        return saveListsData({
          lists: mergedLists,
          listsCount: mergedLists.length,
          timestamp: Date.now()
        }).then(() => sendResponse({ success: true }));
      })
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  // Listes capturées
  if (request.action === 'listsDataCaptured') {
    // Vérifier si on a des listes valides avant de sauvegarder
    const hasValidLists = request.data.lists &&
      Array.isArray(request.data.lists) &&
      request.data.lists.length > 0;

    if (hasValidLists) {
      const listsData = {
        lists: request.data.lists,
        listsCount: request.data.listsCount,
        timestamp: request.data.timestamp || Date.now()
      };

      saveListsData(listsData);
      sendResponse({ success: true });
      return true;
    } else {
      // Pas de listes valides, ne pas écraser le cache existant
      // Récupérer le cache existant pour le renvoyer
      getListsData()
        .then(existingCache => {
          sendResponse({
            success: true,
            preserved: true,
            data: existingCache
          });
        })
        .catch(error => {
          sendResponse({
            success: true,
            preserved: false
          });
        });
      return true;
    }
  }

  // Récupération des listes
  if (request.action === 'getListsData') {
    getListsData()
      .then(data => sendResponse({ success: true, data: data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Effacement des listes
  if (request.action === 'clearListsData') {
    clearListsData()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Démarrage du traitement en arrière-plan
  if (request.action === 'startBackgroundPagination') {
    startBackgroundPagination(
      sender.tab.id,
      request.maxLeads || BACKGROUND_CONFIG.DEFAULT_MAX_LEADS,
      request.dataType || 'lead',
      request.addToList === true,
      request.listName || null
    )
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Arrêt du traitement
  if (request.action === 'stopBackgroundPagination') {
    if (backgroundProcessState.isRunning && backgroundProcessState.bulkContext) {
      requestBulkPause()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message || String(error) }));
      return true;
    }

    const result = stopBackgroundPagination();
    sendResponse(result);
    return true;
  }

  // Arrêt du traitement et récupération des leads
  if (request.action === 'stopAndReturnLeads') {
    const result = stopAndReturnLeads();
    sendResponse(result);
    return true;
  }

  // Annulation complète de l'extraction
  if (request.action === 'cancelExtraction') {
    const result = cancelExtraction();
    sendResponse(result);
    return true;
  }

  // État du traitement
  if (request.action === 'getBackgroundProcessState') {
    const state = getBackgroundProcessState();
    sendResponse(state);
    return true;
  }

  // Upload CSV (passé par le background pour éviter ERR_BLOCKED_BY_CLIENT)
  if (request.action === 'uploadCSV') {
    // Récupérer le nombre de doublons depuis backgroundProcessState si le tabId correspond
    const duplicatesRemoved = (sender.tab && sender.tab.id === backgroundProcessState.tabId)
      ? backgroundProcessState.duplicatesRemoved || 0
      : 0;

    // Récupérer les filters depuis backgroundProcessState si le tabId correspond
    const filters = (sender.tab && sender.tab.id === backgroundProcessState.tabId)
      ? backgroundProcessState.filters || null
      : null;

    // Récupérer le stop_reason depuis backgroundProcessState si le tabId correspond
    const stopReason = (sender.tab && sender.tab.id === backgroundProcessState.tabId)
      ? backgroundProcessState.stopReason || null
      : null;

    uploadCSVFromBackground(request.csvContent, request.filename, request.token, request.apiBaseUrl, request.searchUrl, duplicatesRemoved, filters, stopReason)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Upload Account CSV (passé par le background pour éviter ERR_BLOCKED_BY_CLIENT)
  if (request.action === 'uploadAccountCSV') {
    // Récupérer le nombre de doublons depuis backgroundProcessState si le tabId correspond
    const duplicatesRemoved = (sender.tab && sender.tab.id === backgroundProcessState.tabId)
      ? backgroundProcessState.duplicatesRemoved || 0
      : 0;

    // Récupérer les filters depuis backgroundProcessState si le tabId correspond
    const filters = (sender.tab && sender.tab.id === backgroundProcessState.tabId)
      ? backgroundProcessState.filters || null
      : null;

    // Récupérer le stop_reason depuis backgroundProcessState si le tabId correspond
    const stopReason = (sender.tab && sender.tab.id === backgroundProcessState.tabId)
      ? backgroundProcessState.stopReason || null
      : null;

    uploadAccountCSVFromBackground(request.csvContent, request.filename, request.token, request.apiBaseUrl, request.searchUrl, duplicatesRemoved, filters, stopReason)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Diagnostic temporaire : journalisation côté serveur (à retirer après investigation)
  if (request.action === 'logDiag') {
    logDiagFromBackground(request.event, request.payload, request.token, request.apiBaseUrl)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Récupération du quota (passé par le background pour éviter ERR_BLOCKED_BY_CLIENT)
  if (request.action === 'getQuota') {
    getQuotaFromBackground(request.token, request.apiBaseUrl)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Notification de visite Sales Nav depuis le content script
  if (request.action === 'salesNavVisited') {
    sendOpenedSalesNavWebhook()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  // Détection ping depuis app.totleads.com
  if (request.type === 'TOTLEADS_PING') {
    sendResponse({
      type: 'TOTLEADS_PONG',
      source: 'totleads-extension',
      timestamp: request.timestamp || Date.now()
    });
    return true;
  }
});

// ============================================================================
// DIAGNOSTIC TEMPORAIRE : LOG SERVEUR DEPUIS LE BACKGROUND
// ============================================================================

/**
 * Envoie un événement de diagnostic au serveur (journalisé par client).
 * Fire-and-forget : ne jamais bloquer ou casser le flux pour un log.
 * À retirer une fois l'investigation terminée.
 */
async function logDiagFromBackground(event, payload, token, apiBaseUrl) {
  try {
    const apiUrl = apiBaseUrl || 'https://app.totleads.com';
    let extensionVersion = null;
    try { extensionVersion = chrome.runtime.getManifest().version; } catch (e) { /* noop */ }

    await fetch(`${apiUrl}/api/diag`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        event: event,
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
        extension_version: extensionVersion,
      })
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// FONCTION DE RÉCUPÉRATION DU QUOTA DEPUIS LE BACKGROUND
// ============================================================================

/**
 * Récupère le quota depuis le background script
 * @param {string} token - Token Sanctum
 * @param {string} apiBaseUrl - URL de base de l'API
 * @returns {Promise<Object>} - Résultat de la récupération du quota
 */
async function getQuotaFromBackground(token, apiBaseUrl) {
  try {
    // Utiliser l'URL passée en paramètre ou fallback vers prod
    const apiUrl = apiBaseUrl || 'https://app.totleads.com';

    const response = await fetchWithRetry(`${apiUrl}/api/quota`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Essayer de parser l'erreur JSON pour extraire le message utilisateur
      let errorMessage = `Erreur HTTP ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error) {
          errorMessage = errorData.error;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else {
          errorMessage = errorText;
        }
      } catch (parseError) {
        errorMessage = errorText || `Erreur HTTP ${response.status}`;
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();
    return {
      success: true,
      available_quota: result.available_quota,
      daily_limit: result.daily_limit,
      leads_used_last_24h: result.leads_used_last_24h,
      timestamp: result.timestamp,
      data: result
    };
  } catch (error) {
    throw error;
  }
}

// ============================================================================
// FONCTION D'UPLOAD CSV DEPUIS LE BACKGROUND
// ============================================================================

/**
 * Upload un CSV vers le serveur depuis le background script
 * @param {string} csvContent - Contenu du CSV
 * @param {string} filename - Nom du fichier
 * @param {string} token - Token Sanctum
 * @param {string} apiBaseUrl - URL de base de l'API
 * @param {string} searchUrl - URL courante de la page
 * @param {number} duplicatesRemoved - Nombre de doublons retirés
 * @param {Object|null} filters - Filters de la recherche (metadata.filters)
 * @param {string|null} stopReason - Raison de l'arrêt de l'extraction
 * @returns {Promise<Object>} - Résultat de l'upload
 */
async function uploadCSVFromBackground(csvContent, filename = 'linkedin_leads.csv', token, apiBaseUrl, searchUrl = '', duplicatesRemoved = 0, filters = null, stopReason = null) {
  try {
    // Utiliser l'URL passée en paramètre ou fallback vers prod
    const apiUrl = apiBaseUrl || 'https://app.totleads.com';

    // S'assurer que le nom de fichier a l'extension .csv
    const csvFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;

    // Créer le blob avec le type MIME application/csv
    const blob = new Blob([csvContent], { type: 'application/csv' });
    const formData = new FormData();
    formData.append('csv_file', blob, csvFilename);

    const csvSizeBytes = getTextSizeBytes(csvContent);
    const csvRowsCount = getCsvRowsCount(csvContent);
    formData.append('csv_size_bytes', csvSizeBytes.toString());
    formData.append('csv_rows', csvRowsCount.toString());
    logger.info('[Background] Upload CSV payload', {
      filename: csvFilename,
      sizeBytes: csvSizeBytes,
      sizeMB: Math.round((csvSizeBytes / (1024 * 1024)) * 100) / 100,
      rows: csvRowsCount
    });

    // Récupérer et ajouter le member URN comme 2ème paramètre
    const memberUrn = await getLinkedInMemberUrn();
    if (memberUrn) {
      formData.append('member', memberUrn);
    } else {
      formData.append('member', 'anonymous');
    }

    // Récupérer et ajouter le slug LinkedIn
    const slug = await getLinkedInSlug();
    if (slug) {
      formData.append('slug', slug);
    } else {
      formData.append('slug', 'anonymous');
    }

    // Ajouter l'URL courante comme paramètre search_url
    if (searchUrl) {
      formData.append('search_url', searchUrl);
    }

    // Ajouter le nombre de doublons retirés
    formData.append('doublons', duplicatesRemoved.toString());

    // Ajouter les filters de la recherche (convertir en JSON string si c'est un objet/array)
    if (filters !== null && filters !== undefined) {
      const filtersString = typeof filters === 'string' ? filters : JSON.stringify(filters);
      formData.append('filters', filtersString);
    }

    // Ajouter la raison de l'arrêt de l'extraction
    if (stopReason) {
      formData.append('stop_reason', stopReason);
    }

    // Ajouter la version de l'extension
    try {
      formData.append('extension_version', chrome.runtime.getManifest().version);
    } catch (e) {
      // Erreur silencieuse
    }

    // Faire la requête depuis le background (pas de blocage)
    const response = await fetch(`${apiUrl}/api/upload-csv`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();

      const errorMessage = extractApiErrorMessage(errorText, `Erreur HTTP ${response.status}`);
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return {
      success: true,
      message: 'CSV uploadé avec succès',
      data: result
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Upload un CSV d'accounts vers le serveur depuis le background script
 * @param {string} csvContent - Contenu du CSV
 * @param {string} filename - Nom du fichier
 * @param {string} token - Token Sanctum
 * @param {string} apiBaseUrl - URL de base de l'API
 * @param {string} searchUrl - URL courante de la page
 * @param {number} duplicatesRemoved - Nombre de doublons retirés
 * @param {Object|null} filters - Filters de la recherche (metadata.filters)
 * @param {string|null} stopReason - Raison de l'arrêt de l'extraction
 * @returns {Promise<Object>} - Résultat de l'upload
 */
async function uploadAccountCSVFromBackground(csvContent, filename = 'linkedin_accounts.csv', token, apiBaseUrl, searchUrl = '', duplicatesRemoved = 0, filters = null, stopReason = null) {
  try {
    // Utiliser l'URL passée en paramètre ou fallback vers prod
    const apiUrl = apiBaseUrl || 'https://app.totleads.com';

    // S'assurer que le nom de fichier a l'extension .csv
    const csvFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;

    // Créer le blob avec le type MIME application/csv
    const blob = new Blob([csvContent], { type: 'application/csv' });
    const formData = new FormData();
    formData.append('csv_file', blob, csvFilename);

    const csvSizeBytes = getTextSizeBytes(csvContent);
    const csvRowsCount = getCsvRowsCount(csvContent);
    formData.append('csv_size_bytes', csvSizeBytes.toString());
    formData.append('csv_rows', csvRowsCount.toString());
    logger.info('[Background] Upload account CSV payload', {
      filename: csvFilename,
      sizeBytes: csvSizeBytes,
      sizeMB: Math.round((csvSizeBytes / (1024 * 1024)) * 100) / 100,
      rows: csvRowsCount
    });

    // Récupérer et ajouter le member URN
    const memberUrn = await getLinkedInMemberUrn();
    if (memberUrn) {
      formData.append('member', memberUrn);
    } else {
      formData.append('member', 'anonymous');
    }

    // Récupérer et ajouter le slug LinkedIn
    const slug = await getLinkedInSlug();
    if (slug) {
      formData.append('slug', slug);
    } else {
      formData.append('slug', 'anonymous');
    }

    // Ajouter l'URL courante comme paramètre search_url
    if (searchUrl) {
      formData.append('search_url', searchUrl);
    }

    // Ajouter le nombre de doublons retirés
    formData.append('doublons', duplicatesRemoved.toString());

    // Ajouter les filters de la recherche
    if (filters !== null && filters !== undefined) {
      const filtersString = typeof filters === 'string' ? filters : JSON.stringify(filters);
      formData.append('filters', filtersString);
    }

    // Ajouter la raison de l'arrêt de l'extraction
    if (stopReason) {
      formData.append('stop_reason', stopReason);
    }

    // Ajouter la version de l'extension
    try {
      formData.append('extension_version', chrome.runtime.getManifest().version);
    } catch (e) {
      // Erreur silencieuse
    }

    // Faire la requête vers l'endpoint dédié aux accounts
    const response = await fetch(`${apiUrl}/api/upload-account-csv`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();

      const errorMessage = extractApiErrorMessage(errorText, `Erreur HTTP ${response.status}`);
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return {
      success: true,
      message: 'CSV uploadé avec succès',
      data: result
    };
  } catch (error) {
    throw error;
  }
}

// ============================================================================
// BULK SCRAPE LOGIC
// ============================================================================
const BULK_DEFAULT_MAX_LEADS = 2500;
let bulkScrapeState = {
  isActive: false,
  isPaused: false,
  isPausing: false,
  urls: [],
  currentIndex: 0,
  maxLeads: BULK_DEFAULT_MAX_LEADS,
  dataType: 'lead',
  tabId: null,
  lastError: null,
  pausedProgress: null
};
let bulkUrlStartInProgress = false;

chrome.storage.local.get(['bulkScrapeState', 'bulkScrapeCheckpoint'], (res) => {
  if (res.bulkScrapeState) {
    bulkScrapeState = {
      ...bulkScrapeState,
      ...res.bulkScrapeState,
      lastError: res.bulkScrapeState.lastError || null,
      pausedProgress: res.bulkScrapeState.pausedProgress || null
    };

    // If Chrome suspended the service worker while a pause was being saved,
    // normalize the visible state using the durable checkpoint.
    if (bulkScrapeState.isPausing) {
      bulkScrapeState.isActive = false;
      bulkScrapeState.isPaused = true;
      bulkScrapeState.isPausing = false;
      if (res.bulkScrapeCheckpoint) {
        bulkScrapeState.pausedProgress = {
          currentPage: res.bulkScrapeCheckpoint.currentPage || 1,
          collectedCount: res.bulkScrapeCheckpoint.collectedLeads?.length || 0,
          resumePhase: res.bulkScrapeCheckpoint.resumePhase || 'collect_current_page',
          savedAt: res.bulkScrapeCheckpoint.savedAt || Date.now()
        };
      }
      saveBulkState();
    }

    // Un service worker MV3 peut être suspendu pendant un long bulk. Reprendre
    // l'URL enregistrée avec une navigation complète évite un état "actif" bloqué.
    if (bulkScrapeState.isActive) {
      if (isCheckpointForBulkPosition(res.bulkScrapeCheckpoint)) {
        resumeBulkFromCheckpoint(res.bulkScrapeCheckpoint);
      } else {
        processNextBulkUrl();
      }
    }
  }
});

function saveBulkState() {
  return chrome.storage.local.set({ bulkScrapeState });
}

function isCheckpointForBulkPosition(checkpoint, urls = bulkScrapeState.urls, index = bulkScrapeState.currentIndex) {
  return Boolean(
    checkpoint &&
    Array.isArray(urls) &&
    Number.isInteger(index) &&
    checkpoint.urlIndex === index &&
    checkpoint.url === urls[index] &&
    Array.isArray(checkpoint.collectedLeads)
  );
}

async function startBulkScrape(message, sender) {
  const urls = Array.isArray(message.urls)
    ? message.urls.map(url => String(url).trim()).filter(Boolean)
    : [];
  const tabId = sender.tab ? sender.tab.id : null;

  if (urls.length === 0 || !tabId) {
    return { success: false, error: 'A valid LinkedIn tab and at least one URL are required.' };
  }

  if (backgroundProcessState.isRunning || backgroundProcessState.isFinishing) {
    return { success: false, error: 'An extraction is already running.' };
  }

  const requestedStartIndex = Number.isInteger(message.startIndex) ? message.startIndex : 0;
  const currentIndex = Math.max(0, Math.min(requestedStartIndex, urls.length - 1));
  const previousBulkState = bulkScrapeState;
  const stored = await chrome.storage.local.get(['bulkScrapeCheckpoint']);
  let checkpoint = stored.bulkScrapeCheckpoint;
  let canResumeCheckpoint = isCheckpointForBulkPosition(checkpoint, urls, currentIndex);
  let legacyContinuation = false;

  if (!canResumeCheckpoint && checkpoint) {
    await chrome.storage.local.remove(['bulkScrapeCheckpoint']);
    checkpoint = null;
  }

  // Versions before resumable error checkpoints still stored the failed page
  // and partial-export count in bulkScrapeState. Use that information to avoid
  // restarting an already-exported URL from page 1. The continuation CSV will
  // contain rows from the failed page onward.
  const legacyErrorPage = Number(previousBulkState.lastError?.page);
  const canResumeLegacyPartial = !canResumeCheckpoint &&
    previousBulkState.currentIndex === currentIndex &&
    previousBulkState.urls?.[currentIndex] === urls[currentIndex] &&
    previousBulkState.lastError?.partialExported === true &&
    Number.isInteger(legacyErrorPage) &&
    legacyErrorPage > 1;
  if (canResumeLegacyPartial) {
    const checkpointDataType = previousBulkState.dataType ||
      (urls[currentIndex].includes('/sales/search/company') ? 'account' : 'lead');
    checkpoint = {
      version: 1,
      urlIndex: currentIndex,
      urlNumber: currentIndex + 1,
      totalUrls: urls.length,
      url: urls[currentIndex],
      pageUrl: normalizeBulkCheckpointPageUrl(urls[currentIndex], legacyErrorPage),
      currentPage: legacyErrorPage,
      collectedLeads: [],
      collectedUrns: [],
      duplicatePages: [],
      maxLeads: Number(previousBulkState.maxLeads) || message.maxLeads || BULK_DEFAULT_MAX_LEADS,
      dataType: checkpointDataType,
      filters: null,
      duplicatesRemoved: 0,
      addToList: false,
      listName: null,
      resumePhase: 'collect_current_page',
      lastPageLeadCount: 0,
      reportedTotal: null,
      startTime: Date.now(),
      savedAt: Date.now(),
      legacyPartialExportedRows: Number(previousBulkState.lastError.collectedCount) || 0
    };
    await chrome.storage.local.set({ bulkScrapeCheckpoint: checkpoint });
    canResumeCheckpoint = true;
    legacyContinuation = true;
  }

  bulkScrapeState = {
    isActive: true,
    isPaused: false,
    isPausing: false,
    urls,
    currentIndex,
    maxLeads: canResumeCheckpoint
      ? (Number(checkpoint.maxLeads) || message.maxLeads || BULK_DEFAULT_MAX_LEADS)
      : (message.maxLeads || BULK_DEFAULT_MAX_LEADS),
    dataType: canResumeCheckpoint
      ? (checkpoint.dataType || message.dataType || 'lead')
      : (message.dataType || 'lead'),
    tabId,
    lastError: null,
    pausedProgress: null
  };
  await saveBulkState();

  // Do not hold the message port open for a full page navigation.
  if (canResumeCheckpoint) {
    void resumeBulkFromCheckpoint(checkpoint);
  } else {
    void processNextBulkUrl();
  }

  return {
    success: true,
    resumedFromCheckpoint: canResumeCheckpoint,
    legacyContinuation
  };
}

async function requestBulkPause() {
  if (backgroundProcessState.isFinishing) {
    return {
      success: false,
      error: 'The current URL is already being finalized and saved. Wait for it to finish.'
    };
  }

  const hasBulkRun = backgroundProcessState.isRunning &&
    Boolean(backgroundProcessState.bulkContext);
  if (!bulkScrapeState.isActive && !hasBulkRun) {
    if (bulkScrapeState.isPaused) {
      return { success: true, alreadyPaused: true };
    }
    return { success: false, error: 'There is no active bulk scrape to pause.' };
  }

  if (backgroundProcessState.isRunning && !backgroundProcessState.bulkContext) {
    return { success: false, error: 'A non-bulk extraction is currently running.' };
  }

  bulkScrapeState.isActive = false;
  bulkScrapeState.isPaused = true;
  bulkScrapeState.isPausing = hasBulkRun;
  bulkScrapeState.lastError = null;

  if (hasBulkRun) {
    backgroundProcessState.pauseRequested = true;
    await saveBulkState();

    // Unblock a pending API wait. The running step will then persist a
    // consistent checkpoint before it exits.
    chrome.tabs.sendMessage(backgroundProcessState.tabId, {
      action: 'clearPendingPromises'
    }).catch(() => {});

    return { success: true, pausing: true };
  }

  // The pause happened while loading a new URL, before any leads were
  // collected. Preserve an existing resume checkpoint when this was a
  // checkpoint reload; otherwise Resume will restart this URL from page 1.
  const stored = await chrome.storage.local.get(['bulkScrapeCheckpoint']);
  const checkpoint = stored.bulkScrapeCheckpoint;
  bulkScrapeState.isPausing = false;
  bulkScrapeState.pausedProgress = isCheckpointForBulkPosition(checkpoint)
    ? {
      currentPage: checkpoint.currentPage || 1,
      collectedCount: checkpoint.collectedLeads?.length || 0,
      resumePhase: checkpoint.resumePhase || 'collect_current_page',
      savedAt: checkpoint.savedAt || Date.now()
    }
    : {
      currentPage: 1,
      collectedCount: 0,
      resumePhase: 'collect_current_page',
      savedAt: Date.now()
    };
  if (!isCheckpointForBulkPosition(checkpoint)) {
    await chrome.storage.local.remove(['bulkScrapeCheckpoint']);
  }
  await saveBulkState();
  return { success: true, pausing: false };
}

async function skipBulkUrl() {
  if (bulkScrapeState.isActive || bulkScrapeState.isPausing || backgroundProcessState.isRunning) {
    return { success: false, error: 'Wait until the current URL is fully paused before skipping it.' };
  }

  if (
    !Array.isArray(bulkScrapeState.urls) ||
    bulkScrapeState.currentIndex >= bulkScrapeState.urls.length
  ) {
    return { success: false, error: 'There is no URL left to skip.' };
  }

  const skippedIndex = bulkScrapeState.currentIndex;
  bulkScrapeState.currentIndex++;
  bulkScrapeState.lastError = null;
  bulkScrapeState.isPaused = false;
  bulkScrapeState.isPausing = false;
  bulkScrapeState.pausedProgress = null;
  bulkScrapeState.isActive = bulkScrapeState.currentIndex < bulkScrapeState.urls.length;
  await chrome.storage.local.remove(['bulkScrapeCheckpoint']);
  await saveBulkState();

  if (bulkScrapeState.isActive) {
    // A failure can finish while processNextBulkUrl still owns its short-lived
    // start lock, so schedule the continuation just after the message returns.
    setTimeout(() => processNextBulkUrl(), 250);
  }

  return {
    success: true,
    skippedIndex,
    currentIndex: bulkScrapeState.currentIndex,
    completed: !bulkScrapeState.isActive
  };
}

async function resetBulkScrape() {
  bulkScrapeState = {
    isActive: false,
    isPaused: false,
    isPausing: false,
    urls: [],
    currentIndex: 0,
    maxLeads: BULK_DEFAULT_MAX_LEADS,
    dataType: 'lead',
    tabId: null,
    lastError: null,
    pausedProgress: null
  };
  if (backgroundProcessState.isRunning && backgroundProcessState.bulkContext) {
    backgroundProcessState.stopReason = config.STOP_REASONS.CUT_USER_STOPPED;
    stopBackgroundPagination();
    backgroundProcessState.collectedLeads = [];
    backgroundProcessState.collectedUrns.clear();
    backgroundProcessState.duplicatePagesMap.clear();
  }
  await chrome.storage.local.remove(['bulkScrapeCheckpoint']);
  await saveBulkState();
  return { success: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_BULK_SCRAPE') {
    startBulkScrape(message, sender)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message || String(error) }));
    return true;
  }

  if (message.action === 'PAUSE_BULK_SCRAPE' || message.action === 'STOP_BULK_SCRAPE') {
    requestBulkPause()
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message || String(error) }));
    return true;
  }

  if (message.action === 'SKIP_BULK_URL') {
    skipBulkUrl()
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message || String(error) }));
    return true;
  }

  if (message.action === 'RESET_BULK_SCRAPE') {
    resetBulkScrape()
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message || String(error) }));
    return true;
  }

  if (message.action === 'GET_BULK_SCRAPE_STATE') {
    sendResponse(bulkScrapeState);
    return true;
  }
});

function navigateBulkTab(tabId, url) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeoutId);
    };

    const finish = (error, tab = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(tab);
      }
    };

    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(null, tab);
      }
    };

    const timeoutId = setTimeout(() => {
      finish(new Error(`LinkedIn page did not finish loading within ${BACKGROUND_CONFIG.BULK_NAVIGATION_TIMEOUT / 1000} seconds`));
    }, BACKGROUND_CONFIG.BULK_NAVIGATION_TIMEOUT);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url })
      .then(tab => {
        if (tab?.status === 'complete') {
          finish(null, tab);
        }
      })
      .catch(error => finish(error));
  });
}

async function resumeBulkFromCheckpoint(checkpoint) {
  if (!isCheckpointForBulkPosition(checkpoint)) {
    await chrome.storage.local.remove(['bulkScrapeCheckpoint']);
    void processNextBulkUrl();
    return;
  }

  if (!bulkScrapeState.isActive || bulkUrlStartInProgress || backgroundProcessState.isRunning) {
    return;
  }

  const urlIndex = bulkScrapeState.currentIndex;
  const pageUrl = checkpoint.pageUrl || checkpoint.url;
  bulkUrlStartInProgress = true;

  try {
    if (!bulkScrapeState.tabId) {
      throw new Error('The LinkedIn tab is no longer available.');
    }

    // Reload the exact page recorded by the checkpoint. A full navigation also
    // restores content scripts after a browser or extension restart.
    await navigateBulkTab(bulkScrapeState.tabId, pageUrl);
    if (!bulkScrapeState.isActive || bulkScrapeState.currentIndex !== urlIndex) return;

    await sleep(BACKGROUND_CONFIG.BULK_PAGE_READY_DELAY);
    if (!bulkScrapeState.isActive || bulkScrapeState.currentIndex !== urlIndex) return;

    await chrome.tabs.sendMessage(bulkScrapeState.tabId, {
      action: 'showBulkWindow'
    });
    if (!bulkScrapeState.isActive || bulkScrapeState.currentIndex !== urlIndex) return;

    const runId = nextBackgroundRunId++;
    const dataType = checkpoint.dataType || bulkScrapeState.dataType || 'lead';
    const urnField = dataType === 'account' ? 'entityUrn' : 'objectUrn';
    const collectedLeads = Array.isArray(checkpoint.collectedLeads)
      ? checkpoint.collectedLeads.slice()
      : [];
    const collectedUrns = new Set(
      Array.isArray(checkpoint.collectedUrns) ? checkpoint.collectedUrns.filter(Boolean) : []
    );
    collectedLeads.forEach(item => {
      if (item?.[urnField]) collectedUrns.add(item[urnField]);
    });

    const duplicatePagesMap = new Map(
      Array.isArray(checkpoint.duplicatePages)
        ? checkpoint.duplicatePages.filter(entry =>
          Array.isArray(entry) && entry.length === 2 && Array.isArray(entry[1])
        )
        : []
    );
    const resumePhase = checkpoint.resumePhase === 'navigate_next_page'
      ? 'navigate_next_page'
      : 'collect_current_page';

    backgroundProcessState = {
      isRunning: true,
      runId,
      tabId: bulkScrapeState.tabId,
      currentPage: Math.max(1, Number(checkpoint.currentPage) || 1),
      collectedLeads,
      collectedUrns,
      duplicatePagesMap,
      maxLeads: Number(checkpoint.maxLeads) || bulkScrapeState.maxLeads,
      startTime: checkpoint.startTime || Date.now(),
      lastCollectTimestamp: 0,
      duplicatesRemoved: Number(checkpoint.duplicatesRemoved) || 0,
      filters: checkpoint.filters || null,
      dataType,
      stopReason: null,
      addToList: checkpoint.addToList === true && checkpoint.listName,
      listName: checkpoint.listName || null,
      pageRetryCount: 0,
      failureDetails: null,
      bulkContext: {
        urlIndex,
        urlNumber: urlIndex + 1,
        totalUrls: bulkScrapeState.urls.length,
        url: bulkScrapeState.urls[urlIndex]
      },
      pauseRequested: false,
      isFinishing: false,
      resumePhase,
      lastPageLeadCount: Number(checkpoint.lastPageLeadCount) || 0,
      reportedTotal: Number.isFinite(Number(checkpoint.reportedTotal))
        ? Number(checkpoint.reportedTotal)
        : null,
      captureCurrentPageWithoutTimestamp: resumePhase === 'collect_current_page',
      reloadedForResume: resumePhase === 'navigate_next_page'
    };

    logger.info('[BulkScrape] Resuming from checkpoint', {
      urlNumber: urlIndex + 1,
      currentPage: backgroundProcessState.currentPage,
      collectedCount: collectedLeads.length,
      resumePhase
    });
    void processNextPage(runId);
  } catch (error) {
    logger.error('[BulkScrape] Failed to resume checkpoint', error);
    if (bulkScrapeState.currentIndex === urlIndex && bulkScrapeState.isActive) {
      bulkScrapeState.isActive = false;
      bulkScrapeState.isPaused = true;
      bulkScrapeState.isPausing = false;
      bulkScrapeState.pausedProgress = {
        currentPage: checkpoint.currentPage || 1,
        collectedCount: checkpoint.collectedLeads?.length || 0,
        resumePhase: checkpoint.resumePhase || 'collect_current_page',
        savedAt: checkpoint.savedAt || Date.now()
      };
      bulkScrapeState.lastError = {
        reason: 'resume_failed',
        message: error.message || 'The saved checkpoint could not be reopened.',
        urlIndex,
        urlNumber: urlIndex + 1,
        url: bulkScrapeState.urls[urlIndex] || checkpoint.url,
        collectedCount: checkpoint.collectedLeads?.length || 0,
        partialExported: false,
        timestamp: Date.now()
      };
      await saveBulkState();
      void playExtractionErrorAlert(bulkScrapeState.tabId);
    }
  } finally {
    bulkUrlStartInProgress = false;
    if (bulkScrapeState.isActive && !backgroundProcessState.isRunning) {
      setTimeout(() => processNextBulkUrl(), 250);
    }
  }
}

function pauseBulkBeforePagination(reason, message, details = {}) {
  bulkScrapeState.isActive = false;
  bulkScrapeState.isPaused = false;
  bulkScrapeState.isPausing = false;
  bulkScrapeState.pausedProgress = null;
  bulkScrapeState.lastError = {
    reason,
    message,
    urlIndex: bulkScrapeState.currentIndex,
    urlNumber: bulkScrapeState.currentIndex + 1,
    url: bulkScrapeState.urls[bulkScrapeState.currentIndex] || null,
    timestamp: Date.now(),
    ...details
  };
  chrome.storage.local.remove(['bulkScrapeCheckpoint']).catch(() => {});
  saveBulkState();
  logger.warn('[BulkScrape] Paused before pagination', bulkScrapeState.lastError);
  void playExtractionErrorAlert(bulkScrapeState.tabId);
}

async function processNextBulkUrl() {
  if (!bulkScrapeState.isActive) return;
  if (bulkUrlStartInProgress || backgroundProcessState.isRunning) return;

  bulkUrlStartInProgress = true;
  try {
    if (bulkScrapeState.currentIndex >= bulkScrapeState.urls.length) {
      bulkScrapeState.isActive = false;
      bulkScrapeState.isPaused = false;
      bulkScrapeState.isPausing = false;
      bulkScrapeState.pausedProgress = null;
      chrome.storage.local.remove(['bulkScrapeCheckpoint']).catch(() => {});
      saveBulkState();
      logger.info('[BulkScrape] Completed all URLs.');
      return;
    }

    const urlIndex = bulkScrapeState.currentIndex;
    const nextUrl = bulkScrapeState.urls[urlIndex];
    const totalUrls = bulkScrapeState.urls.length;
    const currentDataType = nextUrl.includes('/sales/search/company')
      ? 'account'
      : (nextUrl.includes('/sales/search/people') ? 'lead' : bulkScrapeState.dataType);
    const bulkContext = {
      urlIndex,
      urlNumber: urlIndex + 1,
      totalUrls,
      url: nextUrl
    };
    logger.info(`[BulkScrape] Processing URL ${bulkContext.urlNumber}/${totalUrls}`);

    if (!bulkScrapeState.tabId) {
      pauseBulkBeforePagination('tab_missing', 'The LinkedIn tab is no longer available.');
      return;
    }

    try {
      // A full document navigation clears LinkedIn's accumulated SPA/React heap and
      // also guarantees that API caches from the previous URL cannot be reused.
      await navigateBulkTab(bulkScrapeState.tabId, nextUrl);

      if (!bulkScrapeState.isActive || bulkScrapeState.currentIndex !== urlIndex) {
        return;
      }

      await sleep(BACKGROUND_CONFIG.BULK_PAGE_READY_DELAY);

      if (!bulkScrapeState.isActive || bulkScrapeState.currentIndex !== urlIndex) {
        return;
      }

      // La navigation complète détruit le DOM précédent. Restaurer la fenêtre
      // de progression avant de lancer la collecte sur la nouvelle page.
      await chrome.tabs.sendMessage(bulkScrapeState.tabId, {
        action: 'showBulkWindow'
      });

      const result = await startBackgroundPagination(
        bulkScrapeState.tabId,
        bulkScrapeState.maxLeads,
        currentDataType,
        false,
        null,
        bulkContext
      );

      if (!result?.success && bulkScrapeState.isActive && bulkScrapeState.currentIndex === urlIndex) {
        pauseBulkBeforePagination(
          'pagination_start_failed',
          result?.error || 'Pagination could not be started.'
        );
      }
    } catch (error) {
      logger.error('[BulkScrape] Failed to load URL', error);
      if (bulkScrapeState.isActive && bulkScrapeState.currentIndex === urlIndex) {
        pauseBulkBeforePagination(
          'navigation_failed',
          error.message || 'The LinkedIn URL could not be loaded.'
        );
      }
    }
  } finally {
    bulkUrlStartInProgress = false;
    if (bulkScrapeState.isActive && !backgroundProcessState.isRunning) {
      setTimeout(() => processNextBulkUrl(), 250);
    }
  }
}
