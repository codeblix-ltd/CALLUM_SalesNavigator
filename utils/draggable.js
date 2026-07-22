/**
 * Utilitaire pour rendre un élément draggable
 * Permet de déplacer une fenêtre en cliquant/glissant sur un header
 */

/**
 * Rend un élément draggable
 * @param {HTMLElement} element - L'élément à rendre draggable
 * @param {HTMLElement} handle - L'élément qui sert de poignée (header, titre, etc.)
 * @param {Object} options - Options de configuration
 * @param {boolean} options.constrainToViewport - Contraindre au viewport (défaut: true)
 * @param {Function} options.onDragStart - Callback au début du drag
 * @param {Function} options.onDrag - Callback pendant le drag
 * @param {Function} options.onDragEnd - Callback à la fin du drag
 * @returns {Function} - Fonction pour détruire le draggable
 */
function makeDraggable(element, handle, options = {}) {
  const {
    constrainToViewport = true,
    onDragStart = null,
    onDrag = null,
    onDragEnd = null,
  } = options;
  
  let isDragging = false;
  let currentX = 0;
  let currentY = 0;
  let initialX = 0;
  let initialY = 0;
  let xOffset = 0;
  let yOffset = 0;
  
  // Appliquer le curseur
  handle.style.cursor = 'move';
  handle.style.userSelect = 'none';
  
  // Récupérer la position initiale si déjà définie
  const computed = window.getComputedStyle(element);
  if (computed.position === 'fixed' || computed.position === 'absolute') {
    const rect = element.getBoundingClientRect();
    xOffset = rect.left;
    yOffset = rect.top;
  }
  
  /**
   * Démarre le drag (souris ou touch)
   */
  function dragStart(e) {
    // Ignorer si pas un clic gauche (souris) ou single touch
    if (e.type === 'mousedown' && e.button !== 0) return;
    if (e.type === 'touchstart' && e.touches.length > 1) return;
    
    // Empêcher la sélection de texte
    e.preventDefault();
    
    if (e.type === 'touchstart') {
      initialX = e.touches[0].clientX - xOffset;
      initialY = e.touches[0].clientY - yOffset;
    } else {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
    }
    
    isDragging = true;
    element.style.cursor = 'grabbing';
    
    if (onDragStart) {
      onDragStart(element);
    }
  }
  
  /**
   * Gère le drag
   */
  function drag(e) {
    if (!isDragging) return;
    
    e.preventDefault();
    
    if (e.type === 'touchmove') {
      currentX = e.touches[0].clientX - initialX;
      currentY = e.touches[0].clientY - initialY;
    } else {
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
    }
    
    xOffset = currentX;
    yOffset = currentY;
    
    // Contraindre au viewport si nécessaire
    if (constrainToViewport) {
      const rect = element.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      
      xOffset = Math.max(0, Math.min(xOffset, maxX));
      yOffset = Math.max(0, Math.min(yOffset, maxY));
    }
    
    setTranslate(xOffset, yOffset, element);
    
    if (onDrag) {
      onDrag(element, { x: xOffset, y: yOffset });
    }
  }
  
  /**
   * Termine le drag
   */
  function dragEnd(e) {
    if (!isDragging) return;
    
    isDragging = false;
    element.style.cursor = '';
    
    if (onDragEnd) {
      onDragEnd(element, { x: xOffset, y: yOffset });
    }
  }
  
  /**
   * Applique la position
   */
  function setTranslate(xPos, yPos, el) {
    el.style.left = `${xPos}px`;
    el.style.top = `${yPos}px`;
  }
  
  // Attacher les événements
  handle.addEventListener('mousedown', dragStart);
  handle.addEventListener('touchstart', dragStart, { passive: false });
  
  document.addEventListener('mousemove', drag);
  document.addEventListener('touchmove', drag, { passive: false });
  
  document.addEventListener('mouseup', dragEnd);
  document.addEventListener('touchend', dragEnd);
  
  // Fonction de nettoyage
  return function destroy() {
    handle.removeEventListener('mousedown', dragStart);
    handle.removeEventListener('touchstart', dragStart);
    
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('touchmove', drag);
    
    document.removeEventListener('mouseup', dragEnd);
    document.removeEventListener('touchend', dragEnd);
    
    handle.style.cursor = '';
    handle.style.userSelect = '';
  };
}

/**
 * Rend un élément draggable avec des paramètres par défaut intelligents
 * Cherche automatiquement un header ou utilise l'élément lui-même
 * @param {HTMLElement} element - L'élément à rendre draggable
 * @param {Object} options - Options (optionnel)
 * @returns {Function} - Fonction pour détruire le draggable
 */
function makeElementDraggable(element, options = {}) {
  // Chercher un header dans l'élément
  const handle = element.querySelector('.header, .title, .modal-header, [data-draggable-handle]') 
                 || element;
  
  return makeDraggable(element, handle, options);
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsDraggable = {
    makeDraggable,
    makeElementDraggable,
  };
}

