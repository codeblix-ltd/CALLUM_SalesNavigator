/**
 * Détecteurs d'événements pour remplacer les délais fixes
 * Améliore les performances en écoutant les vrais événements
 */

/**
 * Obtient un nœud DOM valide pour l'observation MutationObserver
 * Fallback sur document.documentElement si document.body n'existe pas encore
 * @returns {Node}
 */
function getObserverTarget() {
  return document.body || document.documentElement;
}

/**
 * Attend que le DOM soit complètement chargé et stable
 * @param {number} maxWait - Timeout maximum en ms
 * @returns {Promise<void>}
 */
function waitForDOMReady(maxWait = 5000) {
  const logger = window.TotleadsLogger;
  
  return new Promise((resolve) => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      logger?.debug('[EventDetector] DOM déjà prêt');
      resolve();
      return;
    }
    
    logger?.debug('[EventDetector] Attente du DOM...');
    
    const timeout = setTimeout(() => {
      logger?.warn('[EventDetector] Timeout DOM, résolution forcée');
      resolve();
    }, maxWait);
    
    window.addEventListener('DOMContentLoaded', () => {
      clearTimeout(timeout);
      logger?.debug('[EventDetector] DOM prêt');
      resolve();
    }, { once: true });
  });
}

/**
 * Attend qu'une navigation LinkedIn soit terminée
 * Détecte les changements d'URL et la fin du chargement
 * @param {number} maxWait - Timeout maximum en ms
 * @returns {Promise<boolean>} - true si navigation détectée
 */
function waitForNavigationComplete(maxWait = 10000) {
  const logger = window.TotleadsLogger;
  
  return new Promise((resolve) => {
    const initialUrl = window.location.href;
    let navigationDetected = false;
    let settled = false;
    let urlCheckInterval = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (urlCheckInterval) {
        clearInterval(urlCheckInterval);
      }
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      if (!navigationDetected) {
        logger?.warn('[EventDetector] Timeout navigation');
        finish(false);
      }
    }, maxWait);
    
    // Observer les changements d'URL (SPA)
    urlCheckInterval = setInterval(() => {
      if (!navigationDetected && window.location.href !== initialUrl) {
        navigationDetected = true;
        clearInterval(urlCheckInterval);
        urlCheckInterval = null;
        logger?.debug('[EventDetector] Navigation détectée');
        
        // Attendre que le contenu se charge
        waitForContentLoad().then(() => {
          finish(true);
        });
      }
    }, 100);
  });
}

/**
 * Attend que le contenu de la page soit chargé
 * Détecte l'apparition d'éléments clés et l'absence d'animation
 * @param {number} maxWait - Timeout maximum en ms
 * @returns {Promise<void>}
 */
function waitForContentLoad(maxWait = 5000) {
  const logger = window.TotleadsLogger;
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    let lastMutationTime = startTime;
    let mutationCount = 0;
    let settled = false;
    let checkStability = null;
    
    const observer = new MutationObserver(() => {
      lastMutationTime = Date.now();
      mutationCount++;
    });

    const finish = () => {
      if (settled) return;
      settled = true;
      if (checkStability) {
        clearInterval(checkStability);
      }
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    };

    const timeout = setTimeout(() => {
      logger?.debug('[EventDetector] Timeout contenu, résolution');
      finish();
    }, maxWait);
    
    // Nœud sécurisé : document.body s'il existe, sinon document.documentElement
    const targetNode = getObserverTarget();
    observer.observe(targetNode, {
      childList: true,
      subtree: true
    });
    
    // Vérifier périodiquement si le DOM est stable
    checkStability = setInterval(() => {
      const timeSinceLastMutation = Date.now() - lastMutationTime;
      
      // Si pas de mutation depuis 500ms, le DOM est stable
      if (timeSinceLastMutation > 500 && mutationCount > 0) {
        finish();
      }
    }, 100);
  });
}

/**
 * Attend qu'un élément soit visible ET cliquable
 * @param {string} selector - Sélecteur CSS
 * @param {number} maxWait - Timeout maximum en ms
 * @returns {Promise<Element|null>}
 */
function waitForClickableElement(selector, maxWait = 5000) {
  const logger = window.TotleadsLogger;
  
  return new Promise((resolve) => {
    // Vérifier si l'élément existe déjà et est cliquable
    const checkElement = () => {
      const element = document.querySelector(selector);
      if (element && isElementClickable(element)) {
        logger?.debug(`[EventDetector] Élément cliquable trouvé: ${selector}`);
        return element;
      }
      return null;
    };
    
    const existing = checkElement();
    if (existing) {
      resolve(existing);
      return;
    }
    
    logger?.debug(`[EventDetector] Attente élément cliquable: ${selector}`);
    
    const observer = new MutationObserver(() => {
      const element = checkElement();
      if (element) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve(element);
      }
    });

    const timeout = setTimeout(() => {
      observer.disconnect();
      logger?.warn(`[EventDetector] Timeout pour: ${selector}`);
      resolve(null);
    }, maxWait);
    
    const targetNode = getObserverTarget();
    observer.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'style', 'class']
    });
  });
}

/**
 * Vérifie si un élément est réellement cliquable
 * @param {Element} element - Élément à vérifier
 * @returns {boolean}
 */
function isElementClickable(element) {
  if (!element) return false;
  
  // Vérifier si disabled
  if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  
  // Vérifier la visibilité
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  
  // Vérifier si l'élément a une taille
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  
  return true;
}

/**
 * Attend qu'une requête API soit terminée
 * Écoute les appels fetch/XHR avec un pattern d'URL
 * @param {string} urlPattern - Pattern d'URL à surveiller
 * @param {number} maxWait - Timeout maximum en ms
 * @returns {Promise<boolean>}
 */
function waitForApiCall(urlPattern, maxWait = 15000) {
  const logger = window.TotleadsLogger;
  
  return new Promise((resolve) => {
    logger?.debug(`[EventDetector] Attente API: ${urlPattern}`);
    
    const timeout = setTimeout(() => {
      window.removeEventListener('message', messageHandler);
      logger?.warn(`[EventDetector] Timeout API: ${urlPattern}`);
      resolve(false);
    }, maxWait);
    
    const messageHandler = (event) => {
      if (event.source !== window) return;
      
      if (event.data.type === 'LINKEDIN_API_CAPTURED' && 
          event.data.data?.url?.includes(urlPattern)) {
        clearTimeout(timeout);
        window.removeEventListener('message', messageHandler);
        logger?.info(`[EventDetector] API capturée: ${urlPattern}`);
        resolve(true);
      }
    };
    
    window.addEventListener('message', messageHandler);
  });
}

/**
 * Attend un événement personnalisé
 * @param {string} eventName - Nom de l'événement
 * @param {number} maxWait - Timeout maximum en ms
 * @returns {Promise<CustomEvent|null>}
 */
function waitForCustomEvent(eventName, maxWait = 5000) {
  const logger = window.TotleadsLogger;
  
  return new Promise((resolve) => {
    logger?.debug(`[EventDetector] Attente événement: ${eventName}`);
    
    const timeout = setTimeout(() => {
      window.removeEventListener(eventName, eventHandler);
      logger?.warn(`[EventDetector] Timeout événement: ${eventName}`);
      resolve(null);
    }, maxWait);
    
    const eventHandler = (event) => {
      clearTimeout(timeout);
      window.removeEventListener(eventName, eventHandler);
      logger?.debug(`[EventDetector] Événement reçu: ${eventName}`);
      resolve(event);
    };
    
    window.addEventListener(eventName, eventHandler, { once: true });
  });
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsEventDetectors = {
    waitForDOMReady,
    waitForNavigationComplete,
    waitForContentLoad,
    waitForClickableElement,
    isElementClickable,
    waitForApiCall,
    waitForCustomEvent,
  };
}
