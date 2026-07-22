// Script d'interception des API LinkedIn
(function() {
    'use strict';

    // ─── Diagnostic temporaire ───────────────────────────────────────────────
    // Mettre à false pour désactiver tous les logs de diagnostic d'un coup.
    // Objectif : vérifier si la page company déclenche plusieurs réponses
    // `salesApiAccountSearch` concurrentes (totaux différents) et laquelle "gagne".
    const TOTLEADS_DIAG = true;
    function totleadsDiagAccount(source, data, urlString) {
      if (!TOTLEADS_DIAG) return;
      try {
        console.log('[Totleads][diag] account-search captée', {
          source,                                              // 'fetch' | 'xhr-blob' | 'xhr-text'
          total: data && data.paging ? data.paging.total : undefined,
          elementsCount: data && Array.isArray(data.elements) ? data.elements.length : null,
          hasFilters: !!(data && data.metadata && data.metadata.filters),
          ts: Date.now(),
          url: (urlString || '').slice(0, 200)
        });
      } catch (e) { /* ne jamais casser l'interception pour un log */ }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      const urlString = typeof args[0] === 'string' ? args[0] : args[0].url;
      
      if (urlString && urlString.includes('salesApiLeadSearch')) {
        try {
          const clonedResponse = response.clone();
          const contentType = response.headers.get('content-type');
          
          if (contentType && contentType.includes('application/json')) {
            const data = await clonedResponse.json();
            
            if (data.elements && Array.isArray(data.elements)) {

              window.postMessage({
                type: 'LINKEDIN_API_CAPTURED',
                data: {
                  url: urlString,
                  method: args[1]?.method || 'GET',
                  elements: data.elements,
                  elementsCount: data.elements.length,
                  statusCode: response.status,
                  fullResponse: data,
                  metadata: data.metadata,
                  timestamp: Date.now()
                }
              }, '*');
            }
          }
        } catch (error) {
          // Erreur silencieuse
        }
      }

      // Intercepter salesApiAccountSearch pour les companies
      if (urlString && urlString.includes('salesApiAccountSearch')) {
        try {
          const clonedResponse = response.clone();
          const contentType = response.headers.get('content-type');

          if (contentType && contentType.includes('application/json')) {
            const data = await clonedResponse.json();

            totleadsDiagAccount('fetch', data, urlString);

            if (data.elements && Array.isArray(data.elements)) {

              window.postMessage({
                type: 'LINKEDIN_ACCOUNTS_API_CAPTURED',
                data: {
                  url: urlString,
                  method: args[1]?.method || 'GET',
                  elements: data.elements,
                  elementsCount: data.elements.length,
                  statusCode: response.status,
                  fullResponse: data,
                  metadata: data.metadata,
                  timestamp: Date.now()
                }
              }, '*');
            }
          }
        } catch (error) {
          // Erreur silencieuse
        }
      }
      
      return response;
    };
    
    // Intercepter aussi XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      this._method = method;
      this._url = url;
      return originalXHROpen.apply(this, [method, url, ...args]);
    };
    
    XMLHttpRequest.prototype.send = function(data) {
      const xhr = this;
      
      xhr.addEventListener('load', function() {
        // Capturer salesApiNavChrome pour extraire le member URN
        if (xhr._url && xhr._url.includes('salesApiNavChrome')) {
          try {
            if (xhr.responseType === 'blob') {
              // Lire le blob de manière asynchrone
              xhr.response.text().then(responseText => {
                if (!responseText || responseText.length === 0) {
                  return;
                }
                
                try {
                  const data = JSON.parse(responseText);
                  
                  if (data.member) {
                    window.postMessage({
                      type: 'LINKEDIN_MEMBER_CAPTURED',
                      data: {
                        member: data.member,
                        timestamp: Date.now()
                      }
                    }, '*');
                  }
                } catch (parseError) {
                  // Erreur silencieuse
                }
              }).catch(() => {
                // Erreur silencieuse
              });
              
              return;
            } else {
              const responseData = xhr.responseText;
              
              if (!responseData || responseData.length === 0) {
                return;
              }
              
              const data = JSON.parse(responseData);
              
              if (data.member) {
                window.postMessage({
                  type: 'LINKEDIN_MEMBER_CAPTURED',
                  data: {
                    member: data.member,
                    timestamp: Date.now()
                  }
                }, '*');
              }
            }
          } catch (error) {
            // Erreur silencieuse
          }
        }
        
        if (xhr._url && xhr._url.includes('salesApiLeadSearch')) {
          try {
            if (xhr.responseType === 'blob') {
              // Lire le blob de manière asynchrone
              xhr.response.text().then(responseText => {
                if (!responseText || responseText.length === 0) {
                  return;
                }
                
                try {
                  const data = JSON.parse(responseText);
                  
                  if (data.elements && Array.isArray(data.elements)) {
                    // Construire l'URL complète
                    const fullUrl = xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`;

                    window.postMessage({
                      type: 'LINKEDIN_API_CAPTURED',
                      data: {
                        url: fullUrl,
                        method: xhr._method || 'GET',
                        elements: data.elements,
                        elementsCount: data.elements.length,
                        statusCode: xhr.status,
                        fullResponse: data,
                        metadata: data.metadata,
                        timestamp: Date.now()
                      }
                    }, '*');
                  }
                } catch (parseError) {
                  // Erreur silencieuse
                }
              }).catch(() => {
                // Erreur silencieuse
              });

              return;
            } else {
              const responseData = xhr.responseText;

              if (!responseData || responseData.length === 0) {
                return;
              }

              const data = JSON.parse(responseData);

              if (data.elements && Array.isArray(data.elements)) {
                const fullUrl = xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`;

                window.postMessage({
                  type: 'LINKEDIN_API_CAPTURED',
                  data: {
                    url: fullUrl,
                    method: xhr._method || 'GET',
                    elements: data.elements,
                    elementsCount: data.elements.length,
                    statusCode: xhr.status,
                    fullResponse: data,
                    metadata: data.metadata,
                    timestamp: Date.now()
                  }
                }, '*');
              }
            }
          } catch (error) {
            // Erreur silencieuse
          }
        }

        // Capturer salesApiAccountSearch pour les companies
        if (xhr._url && xhr._url.includes('salesApiAccountSearch')) {
          try {
            if (xhr.responseType === 'blob') {
              // Lire le blob de manière asynchrone
              xhr.response.text().then(responseText => {
                if (!responseText || responseText.length === 0) {
                  return;
                }
                
                try {
                  const data = JSON.parse(responseText);
                  
                  if (data.elements && Array.isArray(data.elements)) {
                    // Construire l'URL complète
                    const fullUrl = xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`;

                    totleadsDiagAccount('xhr', data, fullUrl);

                    window.postMessage({
                      type: 'LINKEDIN_ACCOUNTS_API_CAPTURED',
                      data: {
                        url: fullUrl,
                        method: xhr._method || 'GET',
                        elements: data.elements,
                        elementsCount: data.elements.length,
                        statusCode: xhr.status,
                        fullResponse: data,
                        metadata: data.metadata,
                        timestamp: Date.now()
                      }
                    }, '*');
                  }
                } catch (parseError) {
                  // Erreur silencieuse
                }
              }).catch(() => {
                // Erreur silencieuse
              });

              return;
            } else {
              const responseData = xhr.responseText;

              if (!responseData || responseData.length === 0) {
                return;
              }

              const data = JSON.parse(responseData);

              if (data.elements && Array.isArray(data.elements)) {
                const fullUrl = xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`;

                totleadsDiagAccount('xhr-text', data, fullUrl);

                window.postMessage({
                  type: 'LINKEDIN_ACCOUNTS_API_CAPTURED',
                  data: {
                    url: fullUrl,
                    method: xhr._method || 'GET',
                    elements: data.elements,
                    elementsCount: data.elements.length,
                    statusCode: xhr.status,
                    fullResponse: data,
                    metadata: data.metadata,
                    timestamp: Date.now()
                  }
                }, '*');
              }
            }
          } catch (error) {
            // Erreur silencieuse
          }
        }
        
        // Capturer POST salesApiLists (création de liste à la volée)
        if (xhr._url && xhr._url.includes('salesApiLists') && (xhr._method || '').toUpperCase() === 'POST' && !xhr._url.includes('listSources')) {
          try {
            const parseListCreatedResponse = (data) => {
              if (!data || typeof data !== 'object' || !data.id || !data.name) {
                return null;
              }
              if (data.listType && data.listType.toUpperCase() !== 'ACCOUNT') {
                return null;
              }
              return {
                id: data.id,
                name: data.name,
                entityCount: 0,
                listSource: data.role || 'OWNER'
              };
            };
            const emitListCreated = (list) => {
              if (list) {
                window.postMessage({
                  type: 'LINKEDIN_LIST_CREATED',
                  data: { list: list, timestamp: Date.now() }
                }, '*');
              }
            };
            if (xhr.responseType === 'blob') {
              xhr.response.text().then(responseText => {
                if (!responseText || responseText.length === 0) return;
                try {
                  const data = JSON.parse(responseText);
                  emitListCreated(parseListCreatedResponse(data));
                } catch (e) { /* ignore */ }
              }).catch(() => {});
              return;
            }
            const responseData = xhr.responseText;
            if (responseData && responseData.length > 0) {
              try {
                const data = JSON.parse(responseData);
                emitListCreated(parseListCreatedResponse(data));
              } catch (e) { /* ignore */ }
            }
          } catch (error) {
            // Erreur silencieuse
          }
        }

        // Capturer salesApiLists pour récupérer les listes disponibles
        if (xhr._url && xhr._url.includes('salesApiLists') && xhr._url.includes('listSources')) {
          try {
            // Parser l'URL pour extraire le paramètre listType
            const urlObj = new URL(xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`);
            const listType = urlObj.searchParams.get('listType');
            
            // Ne capturer que si listType est égal à "account" (en minuscules)
            if (!listType || listType.toLowerCase() !== 'account') {
              return;
            }
          } catch (urlError) {
            // Si l'URL ne peut pas être parsée, ne pas capturer
            return;
          }
          
          try {
            if (xhr.responseType === 'blob') {
              // Lire le blob de manière asynchrone
              xhr.response.text().then(responseText => {
                if (!responseText || responseText.length === 0) {
                  return;
                }
                
                try {
                  const data = JSON.parse(responseText);
                  
                  if (data.elements && Array.isArray(data.elements)) {
                    // Extraire uniquement les noms des listes
                    const lists = data.elements.map(item => ({
                      id: item.id,
                      name: item.name,
                      entityCount: item.entityCount || 0,
                      listSource: item.listSource
                    }));
                    
                    // Construire l'URL complète
                    const fullUrl = xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`;
                    
                    window.postMessage({
                      type: 'LINKEDIN_LISTS_CAPTURED',
                      data: {
                        url: fullUrl,
                        method: xhr._method || 'GET',
                        lists: lists,
                        listsCount: lists.length,
                        statusCode: xhr.status,
                        fullResponse: data,
                        timestamp: Date.now()
                      }
                    }, '*');
                  }
                } catch (parseError) {
                  // Erreur silencieuse
                }
              }).catch(() => {
                // Erreur silencieuse
              });
              
              return;
            } else {
              const responseData = xhr.responseText;
              
              if (!responseData || responseData.length === 0) {
                return;
              }
              
              const data = JSON.parse(responseData);
              
              if (data.elements && Array.isArray(data.elements)) {
                // Extraire uniquement les noms des listes
                const lists = data.elements.map(item => ({
                  id: item.id,
                  name: item.name,
                  entityCount: item.entityCount || 0,
                  listSource: item.listSource
                }));
                
                const fullUrl = xhr._url.startsWith('http') ? xhr._url : `https://www.linkedin.com${xhr._url}`;
                
                window.postMessage({
                  type: 'LINKEDIN_LISTS_CAPTURED',
                  data: {
                    url: fullUrl,
                    method: xhr._method || 'GET',
                    lists: lists,
                    listsCount: lists.length,
                    statusCode: xhr.status,
                    fullResponse: data,
                    timestamp: Date.now()
                  }
                }, '*');
              }
            }
          } catch (error) {
            // Erreur silencieuse
          }
        }
      });
      
      return originalXHRSend.apply(this, [data]);
    };
    
    // Intercepter les changements d'URL (pushState, replaceState)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args);
      
      // Envoyer un message pour notifier le changement d'URL
      window.postMessage({
        type: 'LINKEDIN_URL_CHANGED',
        data: {
          url: location.href,
          timestamp: Date.now()
        }
      }, '*');
      
      return result;
    };
    
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      
      // Envoyer un message pour notifier le changement d'URL
      window.postMessage({
        type: 'LINKEDIN_URL_CHANGED',
        data: {
          url: location.href,
          timestamp: Date.now()
        }
      }, '*');
      
      return result;
    };
    
    // Écouter popstate
    window.addEventListener('popstate', () => {
      window.postMessage({
        type: 'LINKEDIN_URL_CHANGED',
        data: {
          url: location.href,
          timestamp: Date.now()
        }
      }, '*');
    });
  })();