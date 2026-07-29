/**
 * Utilitaires d'accessibilité (A11y)
 * ARIA, navigation clavier, focus management
 */

/**
 * Rend un élément accessible au clavier
 * @param {HTMLElement} element - Élément à rendre accessible
 * @param {Function} onClick - Fonction appelée lors du clic/Enter/Space
 * @param {Object} options - Options ARIA
 */
function makeKeyboardAccessible(element, onClick, options = {}) {
  const {
    role = 'button',
    label = null,
    describedBy = null,
    expanded = null,
    controls = null,
  } = options;
  
  // Si ce n'est pas déjà un élément focusable, le rendre focusable
  if (!element.hasAttribute('tabindex') && !['button', 'a', 'input'].includes(element.tagName.toLowerCase())) {
    element.setAttribute('tabindex', '0');
  }
  
  // Ajouter les attributs ARIA
  if (role) element.setAttribute('role', role);
  if (label) element.setAttribute('aria-label', label);
  if (describedBy) element.setAttribute('aria-describedby', describedBy);
  if (expanded !== null) element.setAttribute('aria-expanded', expanded);
  if (controls) element.setAttribute('aria-controls', controls);
  
  // Gérer les événements clavier
  const keyboardHandler = (e) => {
    // Enter ou Space
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(e);
    }
  };
  
  element.addEventListener('keydown', keyboardHandler);
  
  // Retourner une fonction de nettoyage
  return () => {
    element.removeEventListener('keydown', keyboardHandler);
  };
}

/**
 * Crée une région landmark ARIA
 * @param {HTMLElement} element - Élément à transformer en landmark
 * @param {string} role - Role ARIA (region, navigation, main, etc.)
 * @param {string} label - Label pour le lecteur d'écran
 */
function createLandmark(element, role, label) {
  element.setAttribute('role', role);
  element.setAttribute('aria-label', label);
}

/**
 * Gère le focus trap dans un modal
 * @param {HTMLElement} modal - Élément modal
 * @returns {Function} - Fonction de nettoyage
 */
function trapFocus(modal) {
  const focusableElements = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];
  
  // Fonction pour gérer le trap
  const handleKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    
    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  };
  
  modal.addEventListener('keydown', handleKeyDown);
  
  // Focus le premier élément au démarrage
  if (firstFocusable) {
    firstFocusable.focus();
  }
  
  // Retourner une fonction de nettoyage
  return () => {
    modal.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Gère la fermeture d'un modal avec Échap
 * @param {HTMLElement} modal - Élément modal
 * @param {Function} onClose - Fonction de fermeture
 * @returns {Function} - Fonction de nettoyage
 */
function handleModalEscape(modal, onClose) {
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      onClose();
    }
  };
  
  document.addEventListener('keydown', handleKeyDown);
  
  return () => {
    document.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Annonce un message aux lecteurs d'écran
 * @param {string} message - Message à annoncer
 * @param {string} priority - Priorité (polite|assertive)
 */
function announceToScreenReader(message, priority = 'polite') {
  const logger = window.TotleadsLogger;
  
  // Créer ou récupérer la région live
  let liveRegion = document.getElementById('totleads-sr-live-region');
  
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'totleads-sr-live-region';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', priority);
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.cssText = `
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    `;
    document.body.appendChild(liveRegion);
  }
  
  // Mettre à jour le message
  liveRegion.textContent = message;
  logger?.debug(`[A11y] Annonce SR: ${message}`);
  
  // Nettoyer après 1 seconde
  setTimeout(() => {
    liveRegion.textContent = '';
  }, 1000);
}

/**
 * Rend un bouton accessible
 * @param {HTMLButtonElement} button - Bouton à rendre accessible
 * @param {Object} options - Options ARIA
 */
function makeButtonAccessible(button, options = {}) {
  const {
    label = null,
    describedBy = null,
    expanded = null,
    controls = null,
    pressed = null,
  } = options;
  
  // Attributs ARIA
  if (label) button.setAttribute('aria-label', label);
  if (describedBy) button.setAttribute('aria-describedby', describedBy);
  if (expanded !== null) button.setAttribute('aria-expanded', expanded);
  if (controls) button.setAttribute('aria-controls', controls);
  if (pressed !== null) button.setAttribute('aria-pressed', pressed);
  
  // S'assurer que le bouton a un type
  if (!button.hasAttribute('type')) {
    button.setAttribute('type', 'button');
  }
}

/**
 * Rend un input accessible
 * @param {HTMLInputElement} input - Input à rendre accessible
 * @param {Object} options - Options ARIA
 */
function makeInputAccessible(input, options = {}) {
  const {
    label = null,
    required = false,
    invalid = false,
    describedBy = null,
    errorId = null,
  } = options;
  
  // Attributs ARIA
  if (label) input.setAttribute('aria-label', label);
  if (required) input.setAttribute('aria-required', 'true');
  if (invalid) {
    input.setAttribute('aria-invalid', 'true');
    if (errorId) input.setAttribute('aria-describedby', errorId);
  } else {
    input.setAttribute('aria-invalid', 'false');
    if (describedBy) input.setAttribute('aria-describedby', describedBy);
  }
}

/**
 * Indique visuellement le focus pour la navigation clavier
 * Ajoute des styles de focus visibles
 */
function enhanceFocusVisibility() {
  const style = document.createElement('style');
  style.id = 'totleads-focus-styles';
  style.textContent = `
    /* Focus visible pour navigation clavier */
    *:focus-visible {
      outline: 2px solid #00a86b !important;
      outline-offset: 2px !important;
    }
    
    /* Désactiver outline pour clics souris (pour éviter confusion) */
    *:focus:not(:focus-visible) {
      outline: none !important;
    }
    
    /* Focus sur les boutons */
    button:focus-visible {
      outline: 2px solid #00a86b !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(0, 168, 107, 0.2) !important;
    }
    
    /* Focus sur les inputs */
    input:focus-visible, 
    textarea:focus-visible, 
    select:focus-visible {
      outline: 2px solid #00a86b !important;
      outline-offset: 0 !important;
      border-color: #00a86b !important;
    }
  `;
  
  // Ajouter seulement si pas déjà présent
  if (!document.getElementById('totleads-focus-styles')) {
    document.head.appendChild(style);
  }
}

/**
 * Vérifie le contraste des couleurs (WCAG 2.1)
 * @param {string} foreground - Couleur de premier plan (hex)
 * @param {string} background - Couleur d'arrière-plan (hex)
 * @returns {Object} - {ratio, passes: {AA, AAA}}
 */
function checkColorContrast(foreground, background) {
  // Convertir hex en RGB
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };
  
  // Calculer la luminance relative
  const getLuminance = (rgb) => {
    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(val => {
      val = val / 255;
      return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  
  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);
  
  if (!fgRgb || !bgRgb) return null;
  
  const fgLum = getLuminance(fgRgb);
  const bgLum = getLuminance(bgRgb);
  
  const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);
  
  return {
    ratio: ratio.toFixed(2),
    passes: {
      AA: ratio >= 4.5,  // WCAG AA (texte normal)
      AALarge: ratio >= 3,  // WCAG AA (texte large)
      AAA: ratio >= 7,  // WCAG AAA (texte normal)
      AAALarge: ratio >= 4.5  // WCAG AAA (texte large)
    }
  };
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsA11y = {
    makeKeyboardAccessible,
    createLandmark,
    trapFocus,
    handleModalEscape,
    announceToScreenReader,
    makeButtonAccessible,
    makeInputAccessible,
    enhanceFocusVisibility,
    checkColorContrast,
  };
}

