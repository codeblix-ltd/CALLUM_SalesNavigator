/**
 * Utilitaires pour parser et traiter les données LinkedIn
 */

/**
 * Extrait l'ID membre depuis un URN LinkedIn
 * @param {string} urn - URN LinkedIn
 * @returns {string} - ID membre extrait
 */
function extractUrnId(urn) {
  if (!urn) return '';
  const config = window.TotleadsConfig;
  
  try {
    // Les URN LinkedIn ont généralement le format: urn:li:member:ACoAABcDdEeFfGgHhIiJjKk...
    const parts = urn.split(config.patterns.URN_MEMBER);
    return parts.length > 1 ? parts[1] : '';
  } catch (error) {
    return '';
  }
}

/**
 * Extrait le provider profile ID depuis un URN LinkedIn
 * @param {string} urn - URN LinkedIn
 * @returns {string} - Provider profile ID
 */
function extractProviderProfileId(urn) {
  if (!urn) return '';
  const config = window.TotleadsConfig;
  
  try {
    // Gérer les URN de profils (fs_salesProfile)
    if (urn.includes(config.patterns.URN_FS_SALES_PROFILE)) {
      return urn
        .split(config.patterns.URN_FS_SALES_PROFILE)[1]
        .split(',NAME_SEARCH')[0]
        .replaceAll('(', '')
        .replaceAll(')', '');
    }
    
    // Gérer les URN d'entreprises (fs_salesCompany)
    if (urn.includes(config.patterns.URN_FS_SALES_COMPANY)) {
      return urn.split(config.patterns.URN_FS_SALES_COMPANY)[1];
    }
    
    // Gérer les autres types d'URN (person, etc.)
    if (urn.includes(':')) {
      return urn.split(':').pop();
    }
    
    // Si aucun pattern reconnu, retourner l'URN original
    return urn;
  } catch (error) {
    return urn;
  }
}

/**
 * Optimise une URL d'image LinkedIn en extrayant la partie relative
 * @param {string} imageUrl - URL complète de l'image
 * @returns {string} - Chemin relatif optimisé
 */
function optimizeImageUrl(imageUrl) {
  if (!imageUrl) return '';
  const config = window.TotleadsConfig;
  
  try {
    // Extraire la partie après media.licdn.com/dms/image/v2/
    const parts = imageUrl.split(config.patterns.LINKEDIN_IMAGE_BASE);
    return parts.length > 1 ? parts[1] : imageUrl;
  } catch (error) {
    return imageUrl;
  }
}


/**
 * Construit l'URL complète d'une image de profil depuis les données LinkedIn
 * @param {Object} displayImage - Objet profilePictureDisplayImage
 * @returns {string} - URL complète de l'image
 */
function buildProfileImageUrl(displayImage) {
  if (!displayImage) return '';  
  try {
    const rootUrl = displayImage.rootUrl;
    const artifact = displayImage.artifacts?.[0];
    
    if (artifact && rootUrl) {
      return rootUrl + artifact.fileIdentifyingUrlPathSegment;
    }
    
    return '';
  } catch (error) {
    return '';
  }
}

/**
 * Construit l'URL complète du logo d'une entreprise
 * @param {Object} companyInfo - Objet companyUrnResolutionResult
 * @returns {string} - URL complète du logo
 */
function buildCompanyLogoUrl(companyInfo) {
  if (!companyInfo?.companyPictureDisplayImage) return '';  
  try {
    const rootUrl = companyInfo.companyPictureDisplayImage.rootUrl;
    const artifact = companyInfo.companyPictureDisplayImage.artifacts?.[0];
    
    if (artifact && rootUrl) {
      return rootUrl + artifact.fileIdentifyingUrlPathSegment;
    }
    
    return '';
  } catch (error) {
    return '';
  }
}

/**
 * Formate la date de début de poste
 * @param {Object} startedOn - Objet avec year et month (optionnel)
 * @returns {string} - Date formatée (YYYY-MM ou YYYY)
 */
function formatStartDate(startedOn) {
  if (!startedOn?.year) return '';  
  try {
    if (startedOn.month) {
      return `${startedOn.year}-${String(startedOn.month).padStart(2, '0')}`;
    }
    return String(startedOn.year);
  } catch (error) {
    return '';
  }
}

// Exposer les fonctions globalement
if (typeof window !== 'undefined') {
  window.TotleadsLinkedInParser = {
    extractUrnId,
    extractProviderProfileId,
    optimizeImageUrl,
    buildProfileImageUrl,
    buildCompanyLogoUrl,
    formatStartDate,
  };
}
