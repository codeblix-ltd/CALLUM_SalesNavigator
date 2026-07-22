/**
 * Module de gestion de l'overlay d'onboarding - VERSION PIXEL PERFECT
 * Crée un overlay gris semi-transparent qui met en évidence les boutons cliquables
 */

let overlayElement = null;
let highlightedElement = null;
let currentMode = null;

/**
 * Crée l'overlay si il n'existe pas déjà
 * @returns {HTMLElement} - L'élément overlay
 */
function createOverlay() {
  if (overlayElement) {
    return overlayElement;
  }

  const overlay = document.createElement('div');
  overlay.id = 'totleads-onboarding-overlay';

  // Ajouter les styles CSS
  const style = document.createElement('style');
  style.textContent = `
    #totleads-onboarding-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      z-index: 9999;
      pointer-events: auto;
      transition: opacity 0.3s ease;
    }

    @keyframes totleads-glow-pulse {
      0%, 100% {
        box-shadow: 0 0 20px rgba(0, 168, 107, 0.6), 
                    0 0 40px rgba(0, 168, 107, 0.4),
                    0 0 60px rgba(0, 168, 107, 0.2);
      }
      50% {
        box-shadow: 0 0 30px rgba(0, 168, 107, 0.8), 
                    0 0 60px rgba(0, 168, 107, 0.6),
                    0 0 90px rgba(0, 168, 107, 0.4);
      }
    }
  `;

  // Ajouter le style si pas déjà présent
  if (!document.getElementById('totleads-onboarding-overlay-style')) {
    style.id = 'totleads-onboarding-overlay-style';
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
  overlayElement = overlay;

  return overlay;
}

/**
 * Met en évidence un élément (utilisé pour préparer le bouton clone)
 * @param {HTMLElement} element - L'élément à mettre en évidence
 */
async function highlightElement(element) {
  if (!element) {
    return;
  }

  const logger = window.TotleadsLogger;

  // Retirer le highlight précédent s'il existe
  if (highlightedElement && highlightedElement !== element) {
    highlightedElement.classList.remove('totleads-highlighted-element');
  }

  highlightedElement = element;

  // S'assurer que l'élément est visible (scroll into view si nécessaire)
  try {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    // Fallback si scrollIntoView n'est pas supporté
    element.scrollIntoView();
  }

  // Attendre un peu pour que le scroll se termine
  await new Promise(resolve => setTimeout(resolve, 200));

  // Ajouter la classe de highlight
  element.classList.add('totleads-highlighted-element');

  // Forcer le reflow pour s'assurer que le style est appliqué
  void element.offsetHeight;

  // Vérifier que les styles sont bien appliqués
  const finalComputedStyle = window.getComputedStyle(element);

  // Vérifier que l'élément est bien visible
  const rect = element.getBoundingClientRect();
  const isVisible = rect.width > 0 && rect.height > 0 &&
    rect.top >= 0 && rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth);

  if (!isVisible) {
    // Si l'élément n'est pas visible, réessayer le scroll
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/**
 * Retire le highlight d'un élément
 */
function removeHighlight() {
  if (highlightedElement) {
    highlightedElement.classList.remove('totleads-highlighted-element');

    // Retirer l'effet glow direct si présent
    removeGlowEffect(highlightedElement);

    highlightedElement = null;
  }

  // Supprimer le bouton clone s'il existe
  removeButtonClone();
}

/**
 * Applique l'effet glow directement sur un élément (sans clone)
 * Utilisé pour le bouton Extract Leads qui est déjà au-dessus de l'overlay
 * @param {HTMLElement} element - L'élément sur lequel appliquer l'effet glow
 */
function applyGlowEffect(element) {
  const logger = window.TotleadsLogger;

  if (!element) {
    logger?.warn('[OnboardingOverlay] Impossible d\'appliquer le glow: élément null');
    return;
  }

  const computed = window.getComputedStyle(element);

  // Sauvegarder le box-shadow original pour pouvoir le restaurer
  element._originalBoxShadow = computed.boxShadow !== 'none' ? computed.boxShadow : '';

  // Appliquer l'animation glow
  element.style.animation = 'totleads-glow-pulse 2s ease-in-out infinite';

  // Combiner le box-shadow original avec le glow
  const glowShadow = `
    0 0 20px rgba(0, 168, 107, 0.6), 
    0 0 40px rgba(0, 168, 107, 0.4),
    0 0 60px rgba(0, 168, 107, 0.2)
  `;

  element.style.boxShadow = element._originalBoxShadow
    ? `${glowShadow}, ${element._originalBoxShadow}`
    : glowShadow;

  // S'assurer que le z-index est élevé pour être au-dessus de l'overlay
  element.style.zIndex = '10003';
  element.style.position = 'relative';
}

/**
 * Retire l'effet glow d'un élément
 * @param {HTMLElement} element - L'élément dont retirer l'effet glow
 */
function removeGlowEffect(element) {
  if (!element) return;

  // Restaurer le box-shadow original
  if (element._originalBoxShadow !== undefined) {
    element.style.boxShadow = element._originalBoxShadow;
    delete element._originalBoxShadow;
  }

  // Retirer l'animation
  element.style.animation = '';

  // Retirer les styles de positionnement si nécessaire
  // (on ne les retire pas car ils peuvent être nécessaires pour d'autres raisons)
}

/**
 * Crée un clone visuel d'un bouton pour l'onboarding
 * Le clone est positionné en fixed avec un z-index élevé et redirige les clics vers l'original
 * @param {HTMLElement} originalButton - Le bouton original à cloner
 * @returns {HTMLElement} - Le bouton clone créé
 */
function createButtonClone(originalButton) {
  const logger = window.TotleadsLogger;

  // Forcer un reflow pour s'assurer que les positions sont à jour
  void originalButton.offsetHeight;

  // Obtenir la position exacte du bouton original
  const rect = originalButton.getBoundingClientRect();
  const computed = window.getComputedStyle(originalButton);

  // Créer l'élément clone SANS copier la classe (pour éviter les conflits CSS)
  const clone = document.createElement(originalButton.tagName);
  clone.id = 'totleads-onboarding-button-clone';
  // NE PAS copier className car elle peut contenir des styles conflictuels !

  // Copier le contenu HTML
  clone.innerHTML = originalButton.innerHTML;

  // Copier TOUS les styles visuels importants
  const stylesToCopy = [
    'width', 'height', 'padding', 'margin',
    'border', 'borderRadius', 'borderWidth', 'borderStyle', 'borderColor',
    'background', 'backgroundColor', 'backgroundImage', 'backgroundSize',
    'color', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
    'textAlign', 'textDecoration', 'textTransform',
    'boxShadow', 'opacity', 'cursor',
    'display', 'alignItems', 'justifyContent', 'flexDirection',
    'gap', 'transition'
  ];

  // D'ABORD forcer le positionnement avec !important pour éviter tout conflit
  clone.style.setProperty('position', 'fixed', 'important');
  clone.style.setProperty('top', `${rect.top}px`, 'important');
  clone.style.setProperty('left', `${rect.left}px`, 'important');
  clone.style.setProperty('width', `${rect.width}px`, 'important');
  clone.style.setProperty('height', `${rect.height}px`, 'important');
  clone.style.setProperty('z-index', '10003', 'important');
  clone.style.setProperty('margin', '0', 'important');
  clone.style.setProperty('transform', 'none', 'important');
  clone.style.setProperty('pointer-events', 'auto', 'important');

  // ENSUITE appliquer les styles visuels (sans !important pour ne pas tout casser)
  stylesToCopy.forEach(prop => {
    // Ne pas écraser les styles critiques déjà définis
    if (!['position', 'top', 'left', 'width', 'height', 'margin', 'transform', 'z-index', 'pointer-events'].includes(prop)) {
      clone.style[prop] = computed[prop];
    }
  });

  // Ajouter l'animation glow
  clone.style.animation = 'totleads-glow-pulse 2s ease-in-out infinite';
  clone.style.boxShadow = `
    0 0 20px rgba(0, 168, 107, 0.6), 
    0 0 40px rgba(0, 168, 107, 0.4),
    0 0 60px rgba(0, 168, 107, 0.2),
    ${computed.boxShadow !== 'none' ? computed.boxShadow : ''}
  `;

  // Ajouter un listener pour repositionner le clone si la page scroll/resize
  const updatePosition = () => {
    const newRect = originalButton.getBoundingClientRect();
    clone.style.top = `${newRect.top}px`;
    clone.style.left = `${newRect.left}px`;
  };

  window.addEventListener('scroll', updatePosition, { passive: true });
  window.addEventListener('resize', updatePosition, { passive: true });

  // Stocker les listeners pour les nettoyer plus tard
  clone._updatePosition = updatePosition;

  // Gestionnaire de clic : déclencher le clic sur le bouton original et se supprimer
  clone.addEventListener('click', (e) => {
    // Empêcher la propagation sur le clone
    e.preventDefault();
    e.stopPropagation();

    // Supprimer le clone
    removeButtonClone();

    // Déclencher le clic sur le bouton original
    originalButton.click();
  });

  // Ajouter le clone au document
  document.body.appendChild(clone);

  // CRITIQUE: Re-forcer la position APRÈS l'ajout au DOM
  // car certains styles peuvent modifier la position lors de l'insertion
  clone.style.top = `${rect.top}px`;
  clone.style.left = `${rect.left}px`;
  clone.style.position = 'fixed';
  clone.style.transform = 'none';

  return clone;
}

/**
 * Supprime le bouton clone de l'onboarding
 */
function removeButtonClone() {
  const clone = document.getElementById('totleads-onboarding-button-clone');
  if (clone) {
    // Nettoyer les event listeners
    if (clone._updatePosition) {
      window.removeEventListener('scroll', clone._updatePosition);
      window.removeEventListener('resize', clone._updatePosition);
    }
    clone.remove();
  }
}

/**
 * Active l'overlay pour le bouton export leads
 * @returns {Promise<boolean>} - true si activé avec succès
 */
async function activateForExportButton() {
  const config = window.TotleadsConfig;
  const logger = window.TotleadsLogger;

  try {
    // Attendre que le bouton soit disponible AVANT de créer l'overlay
    let exportButton = document.getElementById(config.selectors.EXPORT_BUTTON_ID);

    // Si le bouton n'existe pas encore, attendre son injection
    if (!exportButton) {
      logger?.debug('[OnboardingOverlay] Bouton export non trouvé, attente de l\'injection...');

      // Attendre jusqu'à 10 secondes
      const maxWait = 10000;
      const startTime = Date.now();

      while (!exportButton && (Date.now() - startTime) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 500));
        exportButton = document.getElementById(config.selectors.EXPORT_BUTTON_ID);
      }
    }

    if (!exportButton) {
      logger?.warn('[OnboardingOverlay] Impossible de trouver le bouton export après attente');
      return false;
    }

    // Attendre un peu pour s'assurer que le bouton est complètement rendu
    await new Promise(resolve => setTimeout(resolve, 100));

    // Créer l'overlay APRÈS avoir trouvé le bouton
    createOverlay();

    // Attendre un peu pour que l'overlay soit complètement rendu
    await new Promise(resolve => setTimeout(resolve, 50));

    // Mettre en évidence le bouton avec la nouvelle stratégie (bouton clone)
    await highlightElement(exportButton);

    // Créer le bouton clone qui sera superposé au bouton original
    createButtonClone(exportButton);

    currentMode = 'export-button';

    return true;
  } catch (error) {
    logger?.error('[OnboardingOverlay] Erreur lors de l\'activation pour export button:', error);
    return false;
  }
}

/**
 * Active l'overlay pour le bouton extract leads dans la floating window
 * Note: Ce bouton est directement highlighté (pas de clone) car il est déjà au-dessus de l'overlay
 * @returns {Promise<boolean>} - true si activé avec succès
 */
async function activateForExtractButton() {
  const logger = window.TotleadsLogger;

  try {
    // S'assurer que l'overlay existe
    if (!overlayElement) {
      createOverlay();
    }

    // Attendre que la floating window soit ouverte et le bouton disponible
    let extractButton = document.querySelector('#linkedin-extractor-window #extractBtn');

    // Si le bouton n'existe pas encore, attendre
    if (!extractButton) {
      logger?.debug('[OnboardingOverlay] Bouton extract non trouvé, attente de l\'ouverture de la fenêtre...');

      // Attendre jusqu'à 10 secondes
      const maxWait = 10000;
      const startTime = Date.now();

      while (!extractButton && (Date.now() - startTime) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 500));
        extractButton = document.querySelector('#linkedin-extractor-window #extractBtn');
      }
    }

    if (!extractButton) {
      logger?.warn('[OnboardingOverlay] Impossible de trouver le bouton extract après attente');
      return false;
    }

    // Mettre en évidence le bouton DIRECTEMENT (sans clone)
    await highlightElement(extractButton);

    // Appliquer l'effet glow directement sur le bouton original
    applyGlowEffect(extractButton);

    currentMode = 'extract-button';

    return true;
  } catch (error) {
    logger?.error('[OnboardingOverlay] Erreur lors de l\'activation pour extract button:', error);
    return false;
  }
}

/**
 * Désactive complètement l'overlay et retire tous les effets
 */
function deactivate() {
  const logger = window.TotleadsLogger;

  try {
    // Retirer le highlight
    removeHighlight();

    // Retirer l'overlay
    if (overlayElement) {
      overlayElement.style.opacity = '0';
      setTimeout(() => {
        if (overlayElement && overlayElement.parentNode) {
          overlayElement.remove();
        }
        overlayElement = null;
      }, 300);
    }

    // Retirer le style si plus utilisé
    const styleElement = document.getElementById('totleads-onboarding-overlay-style');
    if (styleElement) {
      styleElement.remove();
    }

    // Supprimer le bouton clone
    removeButtonClone();

    currentMode = null;
  } catch (error) {
    logger?.error('[OnboardingOverlay] Erreur lors de la désactivation:', error);
  }
}

/**
 * Vérifie si l'overlay est actif
 * @returns {boolean} - true si l'overlay est actif
 */
function isActive() {
  return overlayElement !== null && overlayElement.parentNode !== null;
}

/**
 * Retourne le mode actuel de l'overlay
 * @returns {string|null} - Le mode actuel ('export-button', 'extract-button') ou null
 */
function getCurrentMode() {
  return currentMode;
}

function ensureOverlayCoversFullPage() {
  if (!overlayElement) return;
  overlayElement.style.position = 'fixed';
  overlayElement.style.top = '0';
  overlayElement.style.left = '0';
  overlayElement.style.right = '0';
  overlayElement.style.bottom = '0';
  overlayElement.style.width = '100vw';
  overlayElement.style.height = '100vh';
  overlayElement.style.zIndex = '9999';
  overlayElement.style.opacity = '0.5';
}

function addOverlayResizeListener() {
  if (!overlayElement) return;
  if (!overlayElement._resizeHandler) {
    overlayElement._resizeHandler = () => {
      ensureOverlayCoversFullPage();
    };
    window.addEventListener('resize', overlayElement._resizeHandler);
  }
}

const oldCreateOverlay = createOverlay;
function createOverlayPatched() {
  const overlay = oldCreateOverlay();
  ensureOverlayCoversFullPage();
  addOverlayResizeListener();
  return overlay;
}

createOverlay = createOverlayPatched;

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsOnboardingOverlay = {
    createOverlay,
    highlightElement,
    activateForExportButton,
    activateForExtractButton,
    deactivate,
    isActive,
    getCurrentMode,
    removeHighlight
  };
}