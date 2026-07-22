/**
 * Gestionnaire de la pagination et de la collecte des leads
 * Orchestre la collecte page par page avec navigation automatique
 */

/**
 * Trouve le bouton "Show all results" de manière robuste
 * @returns {Promise<Element|null>} - Bouton trouvé ou null
 */
async function findShowAllResultsButton() {
  const eventDetectors = window.TotleadsEventDetectors;
  
  // Stratégie 1: Chercher par classe contenant _saved-search-link_
  try {
    const linksByClass = document.querySelectorAll('a[class*="_saved-search-link_"]');
    for (const link of linksByClass) {
      const href = link.getAttribute('href') || '';
      
      if (href.includes('/sales/search/people') && 
          eventDetectors.isElementClickable(link)) {
        return link;
      }
    }
  } catch (error) {
    // Continuer avec les autres stratégies
  }
  
  // Stratégie 2: Chercher par href contenant /sales/search/people?savedSearchId=
  const allLinks = document.querySelectorAll('a[href*="/sales/search/people"]');
  for (const link of allLinks) {
    const href = link.getAttribute('href') || '';
    
    if (href.includes('savedSearchId=') &&
        eventDetectors.isElementClickable(link)) {
      return link;
    }
  }
  
  return null;
}

/**
 * Trouve le bouton "Show all results" pour company search
 * @returns {Promise<Element|null>} - Bouton trouvé ou null
 */
async function findShowAllResultsButtonForCompany() {
  const eventDetectors = window.TotleadsEventDetectors;
  
  // Stratégie 1: Chercher par classe contenant _saved-search-link_
  try {
    const linksByClass = document.querySelectorAll('a[class*="_saved-search-link_"]');
    for (const link of linksByClass) {
      const href = link.getAttribute('href') || '';
      
      if (href.includes('/sales/search/company') && 
          eventDetectors.isElementClickable(link)) {
        return link;
      }
    }
  } catch (error) {
    // Continuer avec les autres stratégies
  }
  
  // Stratégie 2: Chercher par href contenant /sales/search/company?savedSearchId=
  const allLinks = document.querySelectorAll('a[href*="/sales/search/company"]');
  for (const link of allLinks) {
    const href = link.getAttribute('href') || '';
    
    if (href.includes('savedSearchId=') &&
        eventDetectors.isElementClickable(link)) {
      return link;
    }
  }
  
  return null;
}

/**
 * Trouve le bouton "View in search" de manière robuste
 * @returns {Promise<Element|null>} - Bouton trouvé ou null
 */
async function findViewInSearchButton() {
  const eventDetectors = window.TotleadsEventDetectors;
  
  // Stratégie 1: Chercher par classe spécifique
  try {
    const buttonByClass = await eventDetectors.waitForClickableElement(
      'a.lists-nav-inline-action-buttons',
      2000
    );
    if (buttonByClass) {
      return buttonByClass;
    }
  } catch (error) {
    // Continuer avec les autres stratégies
  }
  
  // Stratégie 2: Chercher par href contenant /sales/search/people
  const allLinks = document.querySelectorAll('a[href*="/sales/search/people"]');
  for (const link of allLinks) {
    if (eventDetectors.isElementClickable(link)) {
      // Vérifier que le lien contient bien les query params (filters)
      const href = link.getAttribute('href');
      if (href && href.includes('query=')) {
        return link;
      }
    }
  }
  
  // Stratégie 3: Chercher par texte "View in search" (ou variantes)
  const textVariants = [
    'View in search',
    'Voir dans la recherche',
    'Ver en búsqueda',
    'In ricerca visualizza',
    'In Suche anzeigen',
    'عرض في البحث'
  ];
  
  for (const text of textVariants) {
    const elements = Array.from(document.querySelectorAll('a'));
    for (const element of elements) {
      const elementText = element.textContent.trim();
      if (elementText.includes(text) && 
          element.getAttribute('href')?.includes('/sales/search/people') &&
          eventDetectors.isElementClickable(element)) {
        return element;
      }
    }
  }
  
  // Stratégie 4: Chercher par aria-label contenant "View" ou "search"
  const linksWithAriaLabel = document.querySelectorAll('a[aria-label]');
  for (const link of linksWithAriaLabel) {
    const ariaLabel = link.getAttribute('aria-label') || '';
    const href = link.getAttribute('href') || '';
    if ((ariaLabel.toLowerCase().includes('view') || ariaLabel.toLowerCase().includes('search')) &&
        href.includes('/sales/search/people') &&
        eventDetectors.isElementClickable(link)) {
      return link;
    }
  }
  
  return null;
}

/**
 * Lance l'extraction et l'upload CSV avec traitement en arrière-plan
 * @param {Object} credentials - Credentials utilisateur (secretKey)
 * @param {string} dataType - Type de données ('lead' ou 'account')
 * @param {Object} [options] - Options optionnelles (addToList, listName)
 * @returns {Promise<Object>} - Résultat de l'opération
 */
async function handleExtractionFromApi(credentials, dataType = 'lead', options = {}) {
  const config = window.TotleadsConfig;
  const messaging = window.TotleadsMessaging;
  const domHelpers = window.TotleadsDOMHelpers;
  const eventDetectors = window.TotleadsEventDetectors;
  
  try {
    // Vérifier si on est sur la bonne page Sales Navigator (people ou company selon dataType)
    const isValidPage = dataType === 'account'
      ? domHelpers.isOnSalesNavigatorCompanySearch()
      : domHelpers.isOnSalesNavigator();

    if (!isValidPage) {
      // Exception (lead only): Si on est sur /sales/lists/people avec une liste sélectionnée, cliquer sur "View in search"
      const currentUrl = window.location.href;
      // L'URL doit contenir /sales/lists/people/ suivi d'un ID (ex: /sales/lists/people/7353352459114758145)
      const listsPagePattern = /\/sales\/lists\/people\/\d+/;
      const isOnListsPage = listsPagePattern.test(currentUrl);

      if (dataType === 'lead' && isOnListsPage) {
        const viewInSearchButton = await findViewInSearchButton();

        if (viewInSearchButton) {
          viewInSearchButton.click();
          const navigationComplete = await eventDetectors.waitForNavigationComplete(10000);

          if (navigationComplete) {
            await eventDetectors.waitForContentLoad(3000);
            if (!domHelpers.isOnSalesNavigator()) {
              return {
                success: false,
                error: 'Navigation effectuée mais la page de destination n\'est pas valide. Veuillez cliquer sur le bouton "View in search" pour accéder à la page de recherche.'
              };
            }
          } else {
            return {
              success: false,
              error: 'Le bouton a été cliqué mais la navigation n\'a pas été détectée.'
            };
          }
        } else {
          return {
            success: false,
            error: 'Veuillez être sur LinkedIn Sales Navigator pour utiliser cette fonctionnalité.'
          };
        }
      } else {
        return {
          success: false,
          error: 'Veuillez être sur LinkedIn Sales Navigator pour utiliser cette fonctionnalité.'
        };
      }
    }
    
    // Vérifier le type de recherche et cliquer sur "Show all results" si présent
    if (dataType === 'account') {
      // Pour company search
      const showAllButton = await findShowAllResultsButtonForCompany();
      if (showAllButton) {
        try {
          showAllButton.click();
          await eventDetectors.waitForNavigationComplete(5000).catch(() => {});
          await eventDetectors.waitForContentLoad(2000).catch(() => {});
        } catch (error) {
          // En cas d'erreur, continuer quand même l'extraction
        }
      }
    } else {
      // Pour people search
      const showAllButton = await findShowAllResultsButton();
      if (showAllButton) {
        try {
          showAllButton.click();
          await eventDetectors.waitForNavigationComplete(5000).catch(() => {});
          await eventDetectors.waitForContentLoad(2000).catch(() => {});
        } catch (error) {
          // En cas d'erreur, continuer quand même l'extraction
        }
      }
    }
    
    // Lancer le traitement en arrière-plan via le background script
    // Utiliser maxLeads depuis credentials ou la valeur par défaut
    const maxLeads = credentials.maxLeads || config.MAX_LEADS_TO_PROCESS || 50;
    const response = await messaging.sendToBackground(
      config.actions.START_BACKGROUND_PAGINATION,
      {
        maxLeads: maxLeads,
        dataType: dataType,
        addToList: options.addToList === true,
        listName: options.listName || null
      }
    );
    
    if (response && response.success) {
      return {
        success: true,
        message: 'Traitement démarré en arrière-plan. Vous pouvez naviguer vers d\'autres onglets.',
        dataSource: 'BACKGROUND_PROCESS',
        timestamp: Date.now(),
        url: window.location.href
      };
    } else {
      return {
        success: false,
        error: response?.error || 'Erreur lors du démarrage du traitement'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Collecte les leads/accounts de la page actuelle (appelée par le background script)
 * @param {number} afterTimestamp - Timestamp de référence pour filtrer les données
 * @param {string} dataType - Type de données ('lead' ou 'account')
 * @returns {Promise<Object>} - Résultat avec les leads/accounts collectés
 */
async function collectCurrentPageForBackground(afterTimestamp = 0, dataType = 'lead') {
  const config = window.TotleadsConfig;
  const apiDataManager = window.TotleadsAPIDataManager;
  
  try {
    // Attendre que de nouvelles données API soient disponibles
    const maxAttempts = config.delays.API_DATA_MAX_ATTEMPTS || 60;
    const freshData = dataType === 'account'
      ? await apiDataManager.waitForFreshAccountApiData(
          afterTimestamp,
          maxAttempts,
          config.delays.API_DATA_POLL
        )
      : await apiDataManager.waitForFreshApiData(
          afterTimestamp,
          maxAttempts,
          config.delays.API_DATA_POLL
        );
    
    if (freshData && freshData.elements) {
      return {
        success: true,
        leads: freshData.elements,
        metadata: freshData.metadata
      };
    }
    
    return {
      success: false,
      leads: []
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      leads: []
    };
  }
}

/**
 * Navigue vers la page suivante (appelée par le background script)
 * @returns {Promise<Object>} - Résultat de la navigation
 */
async function goToNextPageForBackground() {
  const config = window.TotleadsConfig;
  const eventDetectors = window.TotleadsEventDetectors;
  
  try {
    // Attendre que le bouton "Suivant" soit cliquable
    const nextButton = await eventDetectors.waitForClickableElement(
      config.selectors.PAGINATION_NEXT,
      config.timeouts.BUTTON_NEXT_WAIT
    );
    
    if (nextButton) {
      nextButton.click();

      // Attendre que la navigation soit complète (détection d'événement)
      const navigationComplete = await eventDetectors.waitForNavigationComplete(10000);

      if (navigationComplete) {
        return { success: true };
      } else {
        return { success: true };
      }
    }

    // Aucun bouton "Suivant" actif : distinguer la dernière page légitime
    // (bouton présent mais désactivé) d'un sélecteur/DOM cassé (aucun bouton trouvé)
    const disabledNext = document.querySelector(config.selectors.PAGINATION_NEXT_DISABLED);
    return {
      success: false,
      reason: disabledNext ? 'last_page' : 'next_button_missing'
    };
  } catch (error) {
    // waitForClickableElement peut throw au timeout : si un bouton désactivé existe,
    // c'est la dernière page ; sinon le sélecteur ne matche plus.
    const disabledNext = document.querySelector(config.selectors.PAGINATION_NEXT_DISABLED);
    return {
      success: false,
      reason: disabledNext ? 'last_page' : 'next_button_missing',
      error: error.message
    };
  }
}

/**
 * Génère et uploade le CSV sur le serveur (appelée par le background script)
 * @param {Array} leads - Tableau des leads/accounts à exporter
 * @param {number} maxLeads - Nombre maximum de leads/accounts (optionnel, pour éviter la limitation)
 * @param {string} dataType - Type de données ('lead' ou 'account')
 * @returns {Promise<Object>} - Résultat de l'opération
 */
async function generateAndUploadCSV(leads, maxLeads = null, dataType = 'lead') {
  const csvGenerator = window.TotleadsCSVGenerator;
  
  try {
    // Générer le contenu CSV selon le type
    const csvContent = dataType === 'account'
      ? csvGenerator.generateCSVFromAccountData(leads, maxLeads || leads.length)
      : csvGenerator.generateCSVFromApiData(leads, maxLeads || leads.length);
    
    // Obtenir l'URL courante
    const searchUrl = window.location.href;
    
    // Uploader sur le serveur
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = dataType === 'account' 
      ? `linkedin_accounts_${timestamp}.csv`
      : `linkedin_leads_${timestamp}.csv`;
    
    const uploadResult = dataType === 'account'
      ? await csvGenerator.uploadAccountCSV(csvContent, filename, searchUrl)
      : await csvGenerator.uploadCSV(csvContent, filename, searchUrl);
    
    if (uploadResult.success) {
      return { 
        success: true, 
        message: 'CSV uploadé avec succès sur le serveur',
        filename: filename,
        data: uploadResult.data
      };
    } else {
      // L'erreur est déjà formatée par le backend (message utilisateur extrait du JSON)
      return { 
        success: false, 
        error: uploadResult.error 
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Arrête le traitement en arrière-plan
 * @returns {Promise<Object>} - Résultat de l'arrêt
 */
async function stopBackgroundPagination() {
  const config = window.TotleadsConfig;
  const messaging = window.TotleadsMessaging;
  
  try {
    const response = await messaging.sendToBackground(config.actions.STOP_BACKGROUND_PAGINATION);
    
    if (response && response.success) {
      return response;
    } else {
      return response || { success: false, message: 'Aucun traitement en cours' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Récupère l'état du traitement en arrière-plan
 * @returns {Promise<Object>} - État actuel du traitement
 */
async function getBackgroundProcessState() {
  const config = window.TotleadsConfig;
  const messaging = window.TotleadsMessaging;
  
  try {
    const response = await messaging.sendToBackground(config.actions.GET_BACKGROUND_PROCESS_STATE);
    return response || { isRunning: false, currentPage: 0, leadsCollected: 0, maxLeads: 0 };
  } catch (error) {
    return { isRunning: false, currentPage: 0, leadsCollected: 0, maxLeads: 0 };
  }
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsPaginationManager = {
    handleExtractionFromApi,
    collectCurrentPageForBackground,
    goToNextPageForBackground,
    generateAndUploadCSV,
    stopBackgroundPagination,
    getBackgroundProcessState,
  };
}
