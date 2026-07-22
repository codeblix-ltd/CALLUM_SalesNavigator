/**
 * Dictionnaires statiques des facettes LinkedIn (Industry, Function, Seniority)
 */
if (typeof window !== 'undefined') {
  window.TotleadsFacets = {
    // Top ~68 industries identified in the teardown
    INDUSTRY: [
      "1", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", 
      "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", 
      "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", 
      "54", "55", "56", "57", "58", "59", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69"
    ],
    // 26 Functions
    FUNCTION: [
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", 
      "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26"
    ],
    // 10 Seniority Levels
    SENIORITY: [
      "100", "110", "120", "130", "200", "210", "220", "300", "310", "320"
    ],
    // Dimension order preference (Geography removed for cleaner, safer slicing)
    DIMENSION_ORDER: ['INDUSTRY', 'FUNCTION', 'SENIORITY']
  };
}