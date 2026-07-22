/**
 * Injecteur de l'interface utilisateur (bouton d'export)
 * Gère l'ajout du bouton dans l'interface LinkedIn Sales Navigator
 */

/**
 * Vérifie si le bouton d'export existe déjà
 * @returns {boolean} - true si le bouton existe
 */
function buttonExists() {
  const config = window.TotleadsConfig;
  return !!document.getElementById(config.selectors.EXPORT_BUTTON_ID);
}

/**
 * Gestionnaire de clic sur le bouton d'export
 */
async function handleExportButtonClick() {
  const config = window.TotleadsConfig;
  const messaging = window.TotleadsMessaging;
  
  // Vérifier si on est en mode onboarding
  const onboardingOverlay = window.TotleadsOnboardingOverlay;
  const isOnboarding = onboardingOverlay && onboardingOverlay.isActive() && 
                       onboardingOverlay.getCurrentMode() === 'export-button';
  
  // Envoyer un message pour ouvrir la fenêtre de l'extension
  messaging.postToWindow(
    config.messages.LINKEDIN_EXTRACTOR,
    config.actions.OPEN_FLOATING_WINDOW
  );
  
  // Si on est en mode onboarding, changer l'overlay en mode extract-button
  if (isOnboarding && onboardingOverlay) {
    // Attendre un peu que la fenêtre s'ouvre
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Changer l'overlay en mode extract-button
    await onboardingOverlay.activateForExtractButton();
  }
}

/**
 * Récupère le nombre de leads disponibles depuis le backend (quota)
 * @returns {Promise<number>} - Nombre de leads disponibles (quota)
 */
async function getLeadsCount() {
  const config = window.TotleadsConfig;
  const quotaService = window.TotleadsQuotaService;
  
  try {
    // Utiliser le service de quota centralisé
    if (quotaService) {
      const quota = await quotaService.getQuota();
      
      if (quota !== null && typeof quota === 'number' && quota >= 0) {
        return quota;
      }
    }

    // Valeur par défaut si aucune donnée disponible
    const defaultQuota = config?.MAX_LEADS_TO_PROCESS || 50;
    return defaultQuota;
  } catch (error) {
    return config?.MAX_LEADS_TO_PROCESS || 50;
  }
}

/**
 * Ajoute le bouton d'exportation à l'interface LinkedIn
 * @returns {Promise<boolean>} - true si le bouton a été ajouté avec succès
 */
async function addExportButton() {
  // Empêcher les injections concurrentes qui peuvent créer des doublons
  if (window.__totleads_isButtonInjectionInProgress) {
    return false;
  }
  window.__totleads_isButtonInjectionInProgress = true;

  const config = window.TotleadsConfig;
  const domHelpers = window.TotleadsDOMHelpers;
  const eventDetectors = window.TotleadsEventDetectors;
  const i18n = window.TotleadsI18n;
  
  try {
    // Vérifier si on est sur Sales Navigator
    if (!domHelpers.isOnSalesNavigator()) {
      return false;
    }
    
    // Vérifier si le bouton existe déjà
    if (buttonExists()) {
      return false;
    }
    
    // Attendre que le contenu soit chargé
    await eventDetectors.waitForContentLoad(3000);
    
    // Trouver le conteneur des boutons
    const buttonContainer = await domHelpers.findButtonContainer();
    
    if (!buttonContainer) {
      setTimeout(addExportButton, config.delays.BUTTON_RETRY);
      return false;
    }
    
    // Vérifier à nouveau si le bouton existe déjà (dans le conteneur ou ailleurs)
    // Cette vérification supplémentaire évite les duplications en cas de timing
    if (buttonExists()) {
      return false;
    }
    
    // Vérifier si le bouton existe déjà dans le conteneur trouvé
    const existingButtonInContainer = buttonContainer.querySelector(`#${config.selectors.EXPORT_BUTTON_ID}`);
    if (existingButtonInContainer) {
      return false;
    }
    
    // Récupérer le nombre de leads
    const leadsCount = await getLeadsCount();
    
    // Créer le bouton avec texte traduit et nombre de leads
    const button = domHelpers.createStyledButton({
      id: config.selectors.EXPORT_BUTTON_ID,
      text: i18n.t('extraction.exportButtonWithCount', { count: leadsCount }),
      onClick: handleExportButtonClick,
      leadsCount: leadsCount
    });
    
    // Améliorer l'accessibilité du bouton
    const a11y = window.TotleadsA11y;
    if (a11y) {
      a11y.makeButtonAccessible(button, {
        label: i18n.t('extraction.exportButton')
      });
    }
    
    // Double-check juste avant insertion pour éviter toute course
    if (document.getElementById(config.selectors.EXPORT_BUTTON_ID)) {
      return false;
    }

    // Trouver la div du compteur de résultats et le span à l'intérieur
    const resultsContainer = domHelpers.findResultsCountElement(buttonContainer);
    
    // Insérer le bouton DANS la div des résultats, avant le span
    if (resultsContainer) {
      // Trouver le span contenant le texte des résultats
      const resultsSpan = resultsContainer.querySelector('span');
      if (resultsSpan) {
        // Insérer le bouton dans la div, avant le span
        resultsContainer.insertBefore(button, resultsSpan);
        // Ajouter un margin-right pour espacer du span
        button.style.setProperty('margin-right', '20px', 'important');
      } else {
        // Fallback: ajouter au début de la div des résultats
        resultsContainer.prepend(button);
        button.style.setProperty('margin-right', '20px', 'important');
      }
    } else {
      // Fallback: ajouter à la fin du conteneur principal
      buttonContainer.appendChild(button);
    }
    
    // Initialiser la gestion responsive du bouton
    domHelpers.initResponsiveButtonObserver();
    
    return true;
  } catch (error) {
    // Réessayer en cas d'erreur
    setTimeout(addExportButton, config.delays.BUTTON_RETRY);
    return false;
  } finally {
    window.__totleads_isButtonInjectionInProgress = false;
  }
}

/**
 * Retire le bouton d'exportation de l'interface
 * @returns {boolean} - true si le bouton a été retiré
 */
function removeExportButton() {
  const config = window.TotleadsConfig;
  
  try {
    const button = document.getElementById(config.selectors.EXPORT_BUTTON_ID);
    
    if (button) {
      button.remove();
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Met à jour le quota affiché dans le bouton
 * @param {number} quota - Nouveau quota à afficher
 * @returns {boolean} - true si le bouton a été mis à jour
 */
function updateButtonQuota(quota) {
  const config = window.TotleadsConfig;
  const i18n = window.TotleadsI18n;
  const domHelpers = window.TotleadsDOMHelpers;
  
  try {
    const button = document.getElementById(config.selectors.EXPORT_BUTTON_ID);
    
    if (button && i18n) {
      const label = button.querySelector('[data-totleads-role="export-button-label"]');
      
      if (!label) {
        return false;
      }
      
      // S'assurer que le quota est un nombre valide
      // Accepter 0 comme valeur valide (quota épuisé)
      const displayedQuota = (typeof quota === 'number' && quota >= 0) 
        ? quota 
        : (config?.MAX_LEADS_TO_PROCESS || 50);
      
      if (typeof quota !== 'number' || quota < 0) {
      }

      // Mettre à jour le dataset avec le nouveau quota
      button.dataset.leadsCount = String(displayedQuota);
      
      // Appliquer la responsivité qui adaptera le texte selon la taille de la fenêtre
      if (domHelpers && domHelpers.makeButtonResponsive) {
        domHelpers.makeButtonResponsive();
      } else {
        // Fallback si la fonction responsive n'est pas disponible
        label.textContent = i18n.t('extraction.exportButtonWithCount', { count: displayedQuota });
      }
      
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Initialise l'injection du bouton au chargement de la page
 */
async function initializeButtonInjection() {
  const eventDetectors = window.TotleadsEventDetectors;
  
  // Attendre que le DOM soit complètement prêt
  await eventDetectors.waitForDOMReady();
  
  // Attendre un peu que le contenu LinkedIn se charge
  await eventDetectors.waitForContentLoad(3000);
  
  // Ajouter le bouton
  addExportButton();
}

/**
 * Gère les changements d'URL et réinjecte le bouton si nécessaire
 * Appelée depuis le content script quand inject.js détecte un changement d'URL
 * @param {string} newUrl - Nouvelle URL
 */
async function handleUrlChange(newUrl) {
  const domHelpers = window.TotleadsDOMHelpers;
  const eventDetectors = window.TotleadsEventDetectors;
  
  
  // Attendre que le contenu se charge (délai réduit pour plus de réactivité)
  await eventDetectors.waitForContentLoad(1000);
  
  // Vérifier si on est sur la page de recherche (people)
  const isOnSearchPage = domHelpers.isOnSalesNavigator();
  
  if (isOnSearchPage) {
    // Réinjecter si nécessaire sur la page de recherche
    if (!buttonExists()) {
      addExportButton();
    } else {
    }
  } else {
    // Retirer le bouton si on n'est plus sur la page de recherche (people)
    if (buttonExists()) {
      removeExportButton();
    }
  }
}

/**
 * Observe les changements du DOM pour détecter si le bouton est supprimé
 * et le réinjecter automatiquement (fallback de sécurité)
 */
function observeNavigationChanges() {
  const domHelpers = window.TotleadsDOMHelpers;
  
  // Attendre que le DOM soit prêt avant d'observer
  setTimeout(() => {
    const targetNode = document.querySelector('main') || document.body;
    
    if (!targetNode) {
      return;
    }
    
    let mutationTimeout = null;
    
    new MutationObserver(() => {
      if (mutationTimeout) clearTimeout(mutationTimeout);
      
      mutationTimeout = setTimeout(() => {
        const isOnSearchPage = domHelpers.isOnSalesNavigator();
        if (isOnSearchPage && !buttonExists()) {
          addExportButton();
        }
      }, 500);
    }).observe(targetNode, { 
      subtree: true, 
      childList: true 
    });
  }, 100);
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsUIInjector = {
    addExportButton,
    removeExportButton,
    buttonExists,
    initializeButtonInjection,
    observeNavigationChanges,
    getLeadsCount,
    updateButtonQuota,
    handleUrlChange,
  };
}
