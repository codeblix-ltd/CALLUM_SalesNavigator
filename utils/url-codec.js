/**
 * Parser et injecteur d'URL pour LinkedIn Sales Navigator (Rest.li query format)
 */
function injectFacetIntoUrl(originalUrl, facetType, facetId) {
  try {
    const urlObj = new URL(originalUrl);
    let queryStr = urlObj.searchParams.get('query');
    
    if (!queryStr) return originalUrl; // Not a standard Sales Nav search
    
    // The query is often wrapped in URL encoding, but URLSearchParams auto-decodes the first layer.
    // However, the internal string contains parentheses formatting: (filters:List(...),keywords:...)
    const newFilterStr = `(type:${facetType},values:List((id:${facetId},selectionType:INCLUDED)))`;
    
    const filtersStart = queryStr.indexOf('filters:List(');
    
    if (filtersStart !== -1) {
      // Find where filters:List( starts and inject right after it
      const insertPos = filtersStart + 'filters:List('.length;
      const nextChar = queryStr[insertPos];
      const comma = nextChar === ')' ? '' : ',';
      
      queryStr = queryStr.slice(0, insertPos) + newFilterStr + comma + queryStr.slice(insertPos);
    } else {
      // No filters exist yet. Find the closing bracket of query=(...) safely
      let depth = 0;
      let queryBodyStart = queryStr.indexOf('(');
      let insertPos = -1;
      
      for (let i = queryBodyStart; i < queryStr.length; i++) {
        if (queryStr[i] === '(') depth++;
        else if (queryStr[i] === ')') {
          depth--;
          if (depth === 0) {
            insertPos = i;
            break;
          }
        }
      }
      
      if (insertPos !== -1) {
        const prefix = queryStr.slice(0, insertPos);
        const suffix = queryStr.slice(insertPos);
        const needsComma = prefix[prefix.length - 1] !== '(';
        const comma = needsComma ? ',' : '';
        queryStr = prefix + comma + `filters:List(${newFilterStr})` + suffix;
      }
    }
    
    // Always reset pagination to page 1 for the new child URL
    urlObj.searchParams.set('query', queryStr);
    urlObj.searchParams.delete('page');
    
    return urlObj.toString();
  } catch (err) {
    window.TotleadsLogger?.error('[UrlCodec] Failed to inject facet', err);
    return originalUrl;
  }
}

if (typeof window !== 'undefined') {
  window.TotleadsUrlCodec = { injectFacetIntoUrl };
}