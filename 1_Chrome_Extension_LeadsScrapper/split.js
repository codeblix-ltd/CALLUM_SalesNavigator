const fs = require('fs');

// 1. YOUR ORIGINAL BASE URL
const BASE_URL = "https://www.linkedin.com/sales/search/people?query=(recentSearchParam%3A(id%3A5752546450%2CdoLogHistory%3Atrue)%2Cfilters%3AList((type%3AGEOGRAPHY%2Cvalues%3AList((id%3A103537801%2CselectionType%3AINCLUDED)))%2C(type%3AFOLLOWS_YOUR_COMPANY%2Cvalues%3AList((id%3ACF%2Ctext%3AFollowing%2520your%2520company%2CselectionType%3AINCLUDED)))))&sessionId=l983kbKUSf6ju6gNrFklJQ%3D%3D&viewAllFilters=true";

// 2. THE 9 HEADCOUNT CHUNKS
const headcounts = [
    {id: 'A', text: 'Self-employed'},
    {id: 'B', text: '1-10'},
    {id: 'C', text: '11-50'},
    {id: 'D', text: '51-200'},
    {id: 'E', text: '201-500'},
    {id: 'F', text: '501-1,000'},
    {id: 'G', text: '1,001-5,000'},
    {id: 'H', text: '5,001-10,000'},
    {id: 'I', text: '10,001+'}
];

// 3. THE FUNCTION & SENIORITY CHUNKS (Exactly as you provided)
const fn_bizDev = [{id: '4', text: 'Business Development'}];
const fn_others = [
    {id: '1', text: 'Accounting'}, {id: '6', text: 'Consulting'}, {id: '18', text: 'Operations'},
    {id: '12', text: 'Human Resources'}, {id: '5', text: 'Community and Social Services'},
    {id: '16', text: 'Media and Communication'}, {id: '15', text: 'Marketing'},
    {id: '9', text: 'Entrepreneurship'}, {id: '2', text: 'Administrative'}, 
    {id: '3', text: 'Arts and Design'}, {id: '7', text: 'Education'}, 
    {id: '8', text: 'Engineering'}, {id: '10', text: 'Finance'}, 
    {id: '11', text: 'Healthcare Services'}, {id: '13', text: 'Information Technology'}, 
    {id: '14', text: 'Legal'}
];

const sen_1 = [
    {id: '110', text: 'Entry Level'}, {id: '210', text: 'Experienced Manager'}, 
    {id: '300', text: 'Vice President'}, {id: '130', text: 'Strategic'}, 
    {id: '200', text: 'Entry Level Manager'}, {id: '100', text: 'In Training'}
];
const sen_2 = [{id: '220', text: 'Director'}];
const sen_3 = [{id: '320', text: 'Owner / Partner'}];
const sen_4 = [{id: '310', text: 'CXO'}];
const sen_5 = [{id: '120', text: 'Senior'}];

// Helper to stringify values properly for LinkedIn's backend
function buildValuesString(items, selectionType) {
    return items.map(i => `(id:${i.id},text:${encodeURIComponent(i.text)},selectionType:${selectionType})`).join(',');
}

// 4. THE 7 EXACT FILTER COMBINATIONS YOU DEFINED
const configs = [
    // Combo 1: BizDev INCLUDED + Sen1 INCLUDED
    [
        `(type:FUNCTION,values:List(${buildValuesString(fn_bizDev, 'INCLUDED')}))`,
        `(type:SENIORITY_LEVEL,values:List(${buildValuesString(sen_1, 'INCLUDED')}))`
    ],
    // Combo 2: BizDev INCLUDED + Sen1 EXCLUDED + Sen2 INCLUDED
    [
        `(type:FUNCTION,values:List(${buildValuesString(fn_bizDev, 'INCLUDED')}))`,
        `(type:SENIORITY_LEVEL,values:List(${buildValuesString(sen_1, 'EXCLUDED')},${buildValuesString(sen_2, 'INCLUDED')}))`
    ],
    // Combo 3: BizDev INCLUDED + Sen1,Sen2 EXCLUDED + Sen3 INCLUDED
    [
        `(type:FUNCTION,values:List(${buildValuesString(fn_bizDev, 'INCLUDED')}))`,
        `(type:SENIORITY_LEVEL,values:List(${buildValuesString(sen_1, 'EXCLUDED')},${buildValuesString(sen_2, 'EXCLUDED')},${buildValuesString(sen_3, 'INCLUDED')}))`
    ],
    // Combo 4: BizDev INCLUDED + Sen1,Sen2,Sen3 EXCLUDED + Sen4 INCLUDED
    [
        `(type:FUNCTION,values:List(${buildValuesString(fn_bizDev, 'INCLUDED')}))`,
        `(type:SENIORITY_LEVEL,values:List(${buildValuesString(sen_1, 'EXCLUDED')},${buildValuesString(sen_2, 'EXCLUDED')},${buildValuesString(sen_3, 'EXCLUDED')},${buildValuesString(sen_4, 'INCLUDED')}))`
    ],
    // Combo 5: BizDev INCLUDED + Sen1,Sen2,Sen3,Sen4 EXCLUDED + Sen5 INCLUDED
    [
        `(type:FUNCTION,values:List(${buildValuesString(fn_bizDev, 'INCLUDED')}))`,
        `(type:SENIORITY_LEVEL,values:List(${buildValuesString(sen_1, 'EXCLUDED')},${buildValuesString(sen_2, 'EXCLUDED')},${buildValuesString(sen_3, 'EXCLUDED')},${buildValuesString(sen_4, 'EXCLUDED')},${buildValuesString(sen_5, 'INCLUDED')}))`
    ],
    // Combo 6: BizDev EXCLUDED + Others INCLUDED
    [
        `(type:FUNCTION,values:List(${buildValuesString(fn_bizDev, 'EXCLUDED')},${buildValuesString(fn_others, 'INCLUDED')}))`
    ],
    // Combo 7: BizDev EXCLUDED + Others EXCLUDED (Captures all remaining)
    [
        `(type:FUNCTION,values:List(${buildValuesString(fn_bizDev, 'EXCLUDED')},${buildValuesString(fn_others, 'EXCLUDED')}))`
    ]
];

// 5. GENERATE THE 63 URLs
const urlObj = new URL(BASE_URL);
let queryStr = urlObj.searchParams.get('query'); // Decodes the first layer

let finalUrls = [];

headcounts.forEach(hc => {
    let hcFilter = `(type:COMPANY_HEADCOUNT,values:List(${buildValuesString([hc], 'INCLUDED')}))`;
    
    configs.forEach(conf => {
        // Combine Headcount + Function + Seniority
        let allFilters = [hcFilter, ...conf].join(',');
        
        // Inject safely into the existing filters:List without destroying the Saved Search
        let newQuery = queryStr.replace('filters:List(', `filters:List(${allFilters},`);
        
        urlObj.searchParams.set('query', newQuery);
        
        // We must re-encode everything, but leave ( ) raw so LinkedIn's React frontend doesn't break
        let finalQueryStr = "";
        for (const [key, val] of urlObj.searchParams.entries()) {
            let encodedVal = encodeURIComponent(val)
                .replace(/%28/g, '(')
                .replace(/%29/g, ')');
            finalQueryStr += (finalQueryStr ? '&' : '?') + key + '=' + encodedVal;
        }
        
        finalUrls.push(urlObj.origin + urlObj.pathname + finalQueryStr);
    });
});

// 6. SAVE TO TXT FILE
fs.writeFileSync('split_urls.txt', finalUrls.join('\n'));
console.log(`✅ Success! Generated exactly ${finalUrls.length} mutually exclusive URLs and saved them to 'split_urls.txt'.`);