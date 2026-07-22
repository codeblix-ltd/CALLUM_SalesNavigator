/**
 * Content Script principal - Orchestrateur léger
 * Délègue les fonctionnalités aux modules spécialisés
 */

// Attendre que tous les modules soient chargés
(function waitForModules() {
  if (
    !window.TotleadsConfig ||
    !window.TotleadsI18n ||
    !window.TotleadsA11y ||
    !window.TotleadsMessaging ||
    !window.TotleadsEventDetectors ||
    !window.TotleadsDraggable ||
    !window.TotleadsLinkedInParser ||
    !window.TotleadsCSVGenerator ||
    !window.TotleadsDOMHelpers ||
    !window.TotleadsAPIDataManager ||
    !window.TotleadsPaginationManager ||
    !window.TotleadsUIInjector ||
    !window.TotleadsListAutomation ||
    !window.TotleadsListInjector ||
    !window.TotleadsOnboardingFlow ||
    !window.TotleadsOnboardingOverlay
  ) {
    setTimeout(waitForModules, 100);
    return;
  }

  // Tous les modules sont chargés, initialiser
  initializeContentScript();
})();

/**
 * Initialise le content script
 */
async function initializeContentScript() {
  const uiInjector = window.TotleadsUIInjector;
  const listInjector = window.TotleadsListInjector;
  const i18n = window.TotleadsI18n;

  // 1. Initialiser l'i18n
  await i18n.init();

  // 2. Injecter le script d'interception
  injectInterceptor();

  // 3. Configurer les gestionnaires de messages
  setupMessageHandlers();

  // 4. Initialiser l'injection du bouton d'export (people search)
  uiInjector.initializeButtonInjection();

  // 5. Observer les changements de navigation (LinkedIn SPA)
  uiInjector.observeNavigationChanges();

  // 6. Initialiser l'injection du bouton "Add to list" (company search)
  listInjector.initializeListButtonInjection();

  // 7. Observer les changements pour le bouton "Add to list"
  listInjector.observeListButtonChanges();

  // 8. Vérifier et lancer le flow d'onboarding si nécessaire
  checkOnboardingFlow();

  // 9. Vérifier si on est déjà sur Sales Nav au chargement initial
  checkInitialSalesNavVisit();

  // 10. Capturer le slug LinkedIn si on est sur /feed/ et qu'il n'est pas déjà stocké
  captureLinkedInSlug();
}

/**
 * Injecte le script d'interception dans la page
 */
function injectInterceptor() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');

  script.onload = function () {
    this.remove();
  };

  script.onerror = function () {
    // Erreur silencieuse
  };

  if (!document.querySelector('script[src*="inject.js"]')) {
    (document.head || document.documentElement).appendChild(script);
  }
}

/**
 * Configure les gestionnaires de messages
 */
function setupMessageHandlers() {
  const config = window.TotleadsConfig;
  const messaging = window.TotleadsMessaging;
  const paginationManager = window.TotleadsPaginationManager;

  // Gestionnaire pour window.postMessage
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    // Données API capturées depuis inject.js
    if (event.data.type === config.messages.LINKEDIN_API_CAPTURED) {
      try {
        const apiDataManager = window.TotleadsAPIDataManager;
        // Mettre à jour directement le cache mémoire au lieu d'envoyer au background
        if (apiDataManager && apiDataManager.setLastApiResponse) {
          apiDataManager.setLastApiResponse(event.data.data);
        }
        // Stocker paging.total pour les floating windows (même isolated world)
        const pagingTotal = event.data.data?.fullResponse?.paging?.total;
        if (pagingTotal != null) {
          window.__totleads_lead_search_total = pagingTotal;
        }
      } catch (error) {
        // Erreur silencieuse
      }
    }

    // Données API accounts capturées depuis inject.js
    if (event.data.type === config.messages.LINKEDIN_ACCOUNTS_API_CAPTURED) {
      try {
        const apiDataManager = window.TotleadsAPIDataManager;
        // Mettre à jour directement le cache mémoire pour les accounts
        if (apiDataManager && apiDataManager.setLastAccountApiResponse) {
          apiDataManager.setLastAccountApiResponse(event.data.data);
        }
        // Stocker paging.total pour les floating windows (même isolated world)
        const pagingTotal = event.data.data?.fullResponse?.paging?.total;
        if (pagingTotal != null) {
          // [Totleads][diag] Tracer l'écrasement du total (last-write-wins) entre recherches
          console.log('[Totleads][diag] __totleads_account_search_total maj', {
            ancien: window.__totleads_account_search_total,
            nouveau: pagingTotal,
            elementsCount: event.data.data?.elementsCount,
            urlPage: window.location.href.slice(0, 200)
          });
          window.__totleads_account_search_total = pagingTotal;

          // [Totleads][diag] Historique des captures account de la page (pour beacon serveur)
          const diagLog = window.__totleads_account_search_log || (window.__totleads_account_search_log = []);
          diagLog.push({
            total: pagingTotal,
            elementsCount: event.data.data?.elementsCount,
            ts: Date.now()
          });
          if (diagLog.length > 10) diagLog.shift();
        }
      } catch (error) {
        // Erreur silencieuse
      }
    }

    // Listes capturées depuis inject.js
    if (event.data.type === config.messages.LINKEDIN_LISTS_CAPTURED) {
      try {
        await messaging.sendToBackground(config.actions.LISTS_DATA_CAPTURED, {
          data: event.data.data
        });
      } catch (error) {
        // Erreur silencieuse
      }
    }

    // Liste créée à la volée (POST salesApiLists) depuis inject.js
    if (event.data.type === config.messages.LINKEDIN_LIST_CREATED && event.data.data?.list) {
      try {
        const result = await messaging.sendToBackground(config.actions.LIST_CREATED, {
          list: event.data.data.list
        });
        if (result && result.success) {
          window.postMessage({ type: config.messages.LINKEDIN_LISTS_UPDATED }, '*');
        }
      } catch (error) {
        // Erreur silencieuse
      }
    }

    // Member URN capturé depuis inject.js
    if (event.data.type === 'LINKEDIN_MEMBER_CAPTURED') {
      try {
        const member = event.data.data.member;

        // Stocker dans chrome.storage.local
        await chrome.storage.local.set({ linkedinMemberUrn: member });
      } catch (error) {
        // Erreur silencieuse
      }
    }

    // Demande extraction et upload CSV depuis floating-window
    if (event.data.type === config.messages.LINKEDIN_EXTRACTOR &&
      event.data.action === config.actions.EXTRACT_AND_UPLOAD) {
      const domHelpers = window.TotleadsDOMHelpers;
      const confirmedLastPage = event.data.confirmedLastPage === true;

      if (!confirmedLastPage && domHelpers && domHelpers.isOnLastSearchPage) {
        if (domHelpers.isOnLastSearchPage()) {
          messaging.postToWindow(config.messages.LINKEDIN_EXTRACTOR_RESPONSE, '', {
            data: { lastPageWarning: true }
          });
          return;
        }
      }

      // Déterminer le dataType depuis l'URL
      const dataType = window.location.href.includes('/sales/search/company') ? 'account' : 'lead';
      const options = {
        addToList: event.data.addToList === true,
        listName: event.data.listName || null
      };
      const response = await paginationManager.handleExtractionFromApi(event.data.credentials, dataType, options);
      messaging.postToWindow(config.messages.LINKEDIN_EXTRACTOR_RESPONSE, '', { data: response });
    }

    // Ouvrir la fenêtre flottante depuis le bouton
    if (event.data.type === config.messages.LINKEDIN_EXTRACTOR &&
      event.data.action === config.actions.OPEN_FLOATING_WINDOW) {
      messaging.postToWindow(config.messages.LINKEDIN_EXTRACTOR, config.actions.SHOW_FLOATING_WINDOW);
    }

    // Changement d'URL détecté depuis inject.js
    if (event.data.type === 'LINKEDIN_URL_CHANGED') {
      const newUrl = event.data.data.url;

      // Notifier l'UIInjector pour qu'il vérifie et réinjecte le bouton si nécessaire
      const uiInjector = window.TotleadsUIInjector;
      if (uiInjector && uiInjector.handleUrlChange) {
        uiInjector.handleUrlChange(newUrl);
      }

      // Notifier le ListInjector pour qu'il vérifie et réinjecte le bouton "Add to list" si nécessaire
      const listInjector = window.TotleadsListInjector;
      if (listInjector && listInjector.handleListUrlChange) {
        listInjector.handleListUrlChange(newUrl);
      }

      // Détecter les visites Sales Nav et notifier le background
      handleSalesNavVisit(newUrl);

      // Capturer le slug si navigation vers /feed/
      captureLinkedInSlug();
    }

    // Ouvrir la fenêtre flottante de liste depuis le bouton
    if (event.data.type === config.messages.LINKEDIN_LIST_AUTOMATION &&
      event.data.action === config.actions.OPEN_LIST_WINDOW) {
      messaging.postToWindow(config.messages.LINKEDIN_LIST_AUTOMATION, config.actions.SHOW_LIST_WINDOW);
    }
  });

  // Gestionnaire pour chrome.runtime.onMessage
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Collecter les leads/accounts de la page actuelle
    if (request.action === config.actions.COLLECT_CURRENT_PAGE) {
      paginationManager.collectCurrentPageForBackground(request.afterTimestamp || 0, request.dataType || 'lead')
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message, leads: [] }));
      return true;
    }

    // Naviguer vers la page suivante
    if (request.action === config.actions.GO_TO_NEXT_PAGE) {
      paginationManager.goToNextPageForBackground()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // Ajouter la page courante à une liste (pendant l'extraction CSV)
    if (request.action === config.actions.ADD_CURRENT_PAGE_TO_LIST) {
      const listAutomation = window.TotleadsListAutomation;
      if (!listAutomation || typeof listAutomation.addCurrentPageToList !== 'function') {
        sendResponse({ success: false, error: 'List automation non disponible' });
        return true;
      }
      listAutomation.addCurrentPageToList(request.listName)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // Générer et uploader le CSV sur le serveur
    if (request.action === config.actions.GENERATE_AND_UPLOAD_CSV) {
      paginationManager.generateAndUploadCSV(request.leads, request.maxLeads, request.dataType || 'lead')
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    // Afficher la fenêtre flottante
    if (request.action === config.actions.SHOW_WINDOW) {
      messaging.postToWindow(config.messages.LINKEDIN_EXTRACTOR, config.actions.SHOW_FLOATING_WINDOW);
      sendResponse({ success: true });
      return true;
    }

    // Afficher une erreur d'upload dans la fenêtre flottante
    if (request.action === 'showUploadError') {
      messaging.postToWindow(config.messages.LINKEDIN_EXTRACTOR, 'showUploadError', { error: request.error });
      sendResponse({ success: true });
      return true;
    }

    // Afficher un message de succès d'upload dans la fenêtre flottante
    if (request.action === 'showUploadSuccess') {
      messaging.postToWindow(config.messages.LINKEDIN_EXTRACTOR, 'showUploadSuccess', { data: request.data || {} });
      sendResponse({ success: true });
      return true;
    }

    // Afficher la fenêtre flottante de liste
    if (request.action === config.actions.SHOW_LIST_WINDOW) {
      messaging.postToWindow(config.messages.LINKEDIN_LIST_AUTOMATION, config.actions.SHOW_LIST_WINDOW);
      sendResponse({ success: true });
      return true;
    }

    // Nettoyer les promesses en attente (lors de l'annulation ou de l'arrêt)
    if (request.action === 'clearPendingPromises') {
      const apiDataManager = window.TotleadsAPIDataManager;
      if (apiDataManager && apiDataManager.clearPendingPromises) {
        apiDataManager.clearPendingPromises();
      }
      sendResponse({ success: true });
      return true;
    }
  });
}

/**
 * Vérifie si le flow d'onboarding doit être lancé et le lance si nécessaire
 */
async function checkOnboardingFlow() {
  const onboardingFlow = window.TotleadsOnboardingFlow;

  if (!onboardingFlow) {
    return;
  }

  // Vérifier si le flow doit être lancé
  const onboardingData = onboardingFlow.shouldStartOnboarding();

  if (onboardingData && onboardingData.apiKey) {
    // Attendre un peu que la page soit complètement chargée
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Lancer le flow d'onboarding avec clic collapse filtre
    const result = await onboardingFlow.runOnboardingWithCollapse(onboardingData.apiKey);

    const logger = window.TotleadsLogger;
    if (result.success) {
      logger?.info('[ContentScript] Flow d\'onboarding lancé avec succès');
    } else {
      logger?.warn('[ContentScript] Échec du flow d\'onboarding:', result.error);
    }
  }
}

/**
 * Vérifie si on est sur Sales Nav au chargement initial de la page
 */
async function checkInitialSalesNavVisit() {
  try {
    // Attendre un peu que la page soit chargée
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Utiliser la fonction centralisée
    handleSalesNavVisit(window.location.href);
  } catch (error) {
    // Erreur silencieuse
  }
}

/**
 * Gère la détection de visite Sales Nav de manière centralisée
 * Utilise sessionStorage pour tracker la session (se réinitialise automatiquement)
 * @param {string} url - URL actuelle
 */
async function handleSalesNavVisit(url) {
  try {
    const messaging = window.TotleadsMessaging;
    const storage = window.TotleadsStorageService;
    const isOnSalesNav = url && url.includes('linkedin.com/sales');

    if (isOnSalesNav) {
      // Vérifier si on a déjà notifié dans cette session (tab)
      const alreadyNotified = sessionStorage.getItem('salesNavVisitNotified');

      if (!alreadyNotified) {
        // Marquer comme notifié dans cette session
        sessionStorage.setItem('salesNavVisitNotified', 'true');

        // Notifier le background de la visite Sales Nav
        await messaging.sendToBackground('salesNavVisited', {}).catch(() => {
          // Erreur silencieuse
        });
      }
    }
  } catch (error) {
    // Erreur silencieuse
  }
}

/**
 * Capture le slug LinkedIn de l'utilisateur depuis la page /feed/
 * Ne capture que si on est sur /feed/ ET que le slug n'est pas déjà stocké
 */
async function captureLinkedInSlug() {
  try {
    const currentUrl = window.location.href;
    // Vérifier si on est sur la page /feed/
    if (!currentUrl.includes('linkedin.com/feed')) {
      return;
    }
    // Vérifier si le slug est déjà stocké
    const stored = await chrome.storage.local.get(['slugLK']);
    if (stored.slugLK) {
      return; // Déjà présent, pas besoin de capturer
    }
    // Fonction pour extraire le slug du DOM
    const extractSlug = () => {
      const profileLink = document.querySelector('a[href*="/in/"]');
      if (!profileLink) return null;

      let href = profileLink.getAttribute('href');
      if (!href) return null;

      // Parser : extraire le slug depuis l'URL (complète ou relative)
      // Exemple: "https://www.linkedin.com/in/omarcherkaoui/" ou "/in/omarcherkaoui/"
      const match = href.match(/\/in\/([^\/\?]+)/);
      if (!match || !match[1]) return null;

      return match[1];
    };

    // Tenter d'extraire immédiatement
    let slug = extractSlug();
    // Si pas trouvé, attendre le chargement du DOM (max 10 secondes)
    if (!slug) {
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        slug = extractSlug();
        if (slug) break;
      }
    }
    if (slug) {
      await chrome.storage.local.set({ slugLK: slug });
    }
  } catch (error) {
    // Erreur silencieuse
  }
}
