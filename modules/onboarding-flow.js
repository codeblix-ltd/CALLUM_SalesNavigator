/**
 * Module de gestion du flow d'onboarding automatique
 * Détecte le paramètre onboarding=true dans l'URL et remplit automatiquement la clé API
 */

/**
 * Nettoie l'URL en retirant les paramètres d'onboarding
 * @param {URL} url - URL à nettoyer
 * @returns {string} - Nouvelle URL sans les paramètres d'onboarding
 */
function cleanOnboardingParams(url) {
  const newUrl = new URL(url);
  newUrl.searchParams.delete('onboarding');
  newUrl.searchParams.delete('apiKey');
  newUrl.searchParams.delete('secretKey');
  return newUrl.toString();
}

/**
 * Attend qu'un élément soit disponible dans le DOM
 * @param {string} selector - Sélecteur CSS
 * @param {number} timeout - Timeout en millisecondes
 * @returns {Promise<Element>} - Élément trouvé
 */
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // Vérifier si l'élément existe déjà
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    // Observer les changements du DOM
    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Timeout
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

/**
 * Ouvre la fenêtre flottante principale si elle n'est pas déjà ouverte
 * @returns {Promise<boolean>} - true si la fenêtre est ouverte ou a été ouverte
 */
async function ensureFloatingWindowOpen() {
  const config = window.TotleadsConfig;
  const messaging = window.TotleadsMessaging;
  
  // Vérifier si la fenêtre existe déjà
  const existingWindow = document.getElementById('linkedin-extractor-window');
  if (existingWindow && existingWindow.offsetParent !== null) {
    return true;
  }
  
  // Ouvrir la fenêtre via le système de messaging
  try {
    messaging.postToWindow(config.messages.LINKEDIN_EXTRACTOR, config.actions.SHOW_FLOATING_WINDOW);
    
    // Attendre que la fenêtre soit créée
    await waitForElement('#linkedin-extractor-window', 5000);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Lance le flow d'onboarding automatique
 * @param {string} apiKey - Clé API depuis le paramètre d'URL
 * @returns {Promise<Object>} - Résultat du flow {success: boolean, error?: string}
 */
async function startOnboardingFlow(apiKey) {
  const logger = window.TotleadsLogger;
  
  try {
    // Vérifier que la clé API n'est pas vide
    if (!apiKey || apiKey.trim() === '') {
      logger?.warn('[OnboardingFlow] Clé API manquante ou vide');
      return { success: false, error: 'Clé API manquante' };
    }
    
    logger?.info('[OnboardingFlow] Démarrage du flow d\'onboarding');
    
    // 1. Ouvrir la fenêtre flottante si nécessaire
    const windowOpened = await ensureFloatingWindowOpen();
    if (!windowOpened) {
      logger?.warn('[OnboardingFlow] Impossible d\'ouvrir la fenêtre flottante');
      return { success: false, error: 'Impossible d\'ouvrir la fenêtre flottante' };
    }
    
    // 2. Attendre que l'input soit disponible
    logger?.debug('[OnboardingFlow] Attente de l\'input secretKeyInput');
    const secretKeyInput = await waitForElement('#secretKeyInput', 10000);
    
    // 3. Remplir l'input avec la valeur du paramètre d'URL
    logger?.debug('[OnboardingFlow] Remplissage de l\'input avec la clé API');
    secretKeyInput.value = apiKey.trim();
    
    // 4. Dispatcher un event 'input' pour déclencher la réactivité
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    secretKeyInput.dispatchEvent(inputEvent);
    
    // 5. Dispatcher aussi un event 'change' pour être sûr
    const changeEvent = new Event('change', { bubbles: true, cancelable: true });
    secretKeyInput.dispatchEvent(changeEvent);
    
    // 6. Attendre un peu pour que les événements soient traités
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // 7. Trouver et cliquer sur le bouton de validation
    logger?.debug('[OnboardingFlow] Recherche du bouton de validation');
    const saveButton = await waitForElement('#saveConfigBtn', 5000);
    
    // Vérifier que le bouton n'est pas désactivé
    if (saveButton.disabled) {
      logger?.warn('[OnboardingFlow] Le bouton de validation est désactivé');
      // Attendre un peu et réessayer
      await new Promise(resolve => setTimeout(resolve, 500));
      if (saveButton.disabled) {
        return { success: false, error: 'Le bouton de validation est désactivé' };
      }
    }
    
    logger?.info('[OnboardingFlow] Clic sur le bouton de validation');
    
    // 8. Stocker un flag dans sessionStorage pour indiquer qu'on est dans le flow d'onboarding
    // (car on va nettoyer l'URL juste après)
    sessionStorage.setItem('totleads_onboarding_active', 'true');
    
    saveButton.click();
    
    // 9. Nettoyer l'URL après traitement pour éviter de relancer le flow
    const currentUrl = new URL(window.location.href);
    const cleanedUrl = cleanOnboardingParams(currentUrl);
    
    // Utiliser history.replaceState pour nettoyer l'URL sans recharger la page
    window.history.replaceState({}, '', cleanedUrl);
    
    logger?.info('[OnboardingFlow] Flow d\'onboarding terminé avec succès');
    return { success: true };
    
  } catch (error) {
    logger?.error('[OnboardingFlow] Erreur lors du flow d\'onboarding:', error);
    return { success: false, error: error.message || 'Erreur inconnue' };
  }
}

/**
 * Vérifie si le flow d'onboarding doit être lancé
 * Se lance si on est sur Sales Nav avec les paramètres onboarding=true et apiKey présents
 * Permet la mise à jour de la clé API même si l'utilisateur est déjà connecté
 * @returns {Object|null} - {apiKey: string} si le flow doit être lancé, null sinon
 */
function shouldStartOnboarding() {
  try {
    const url = new URL(window.location.href);
    const isOnSalesNav = url.pathname.includes('/sales/search/people');
    const hasOnboardingParam = url.searchParams.get('onboarding') === 'true';
    const apiKey = url.searchParams.get('apiKey') || url.searchParams.get('secretKey');
    
    // L'onboarding se lance dès que les paramètres sont présents dans l'URL
    // Cela permet aussi de mettre à jour la clé API d'un utilisateur déjà connecté
    if (isOnSalesNav && hasOnboardingParam && apiKey) {
      return { apiKey: apiKey.trim() };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Clique sur le bouton de collapse du panneau de filtres (si présent)
 * Uniquement pendant l'onboarding.
 */
async function clickCollapseFilterButtonIfPresent() {
  try {
    const eventDetectors = window.TotleadsEventDetectors;
    // Attendre que la page soit bien chargée côté DOM
    if (eventDetectors && eventDetectors.waitForContentLoad) {
      await eventDetectors.waitForContentLoad(7000);
    } else {
      await new Promise(res => setTimeout(res, 1500));
    }

    const btn = document.querySelector('button[aria-controls*="search-filter-panel"]');
    if (btn && typeof btn.click === 'function') {
      btn.click();
      window.TotleadsLogger?.info('[OnboardingFlow] Bouton collapse filtre cliqué automatiquement');
      return true;
    }
    return false;
  } catch (e) {
    window.TotleadsLogger?.warn('[OnboardingFlow] Erreur clic collapse filtre:', e);
    return false;
  }
}

/**
 * Lance le flow d'onboarding avec le clic sur le bouton de collapse du panneau de filtres
 * @param {string} apiKey - Clé API depuis le paramètre d'URL
 * @returns {Promise<Object>} - Résultat du flow {success: boolean, error?: string}
 */
async function runOnboardingWithCollapse(apiKey) {
  const startResult = await startOnboardingFlow(apiKey);
  if (startResult.success) {
    await clickCollapseFilterButtonIfPresent();
  }
  return startResult;
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsOnboardingFlow = {
    startOnboardingFlow,
    shouldStartOnboarding,
    cleanOnboardingParams,
    // nouvelle API pour onboarding avec collapse filtre
    runOnboardingWithCollapse,
  };
}

