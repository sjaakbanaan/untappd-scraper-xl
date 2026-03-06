/**
 * Parses numeric strings with 'K', 'M' and '+' suffixes into standard integers.
 * E.g., "2.03M+" -> 2030000
 * @param {string} valueStr 
 * @returns {number}
 */
export function parseAbbreviatedNumber(valueStr) {
  if (!valueStr) return 0;
  
  let formattedStr = valueStr.trim().replace(/,/g, "").toUpperCase();

  let multiplier = 1;
  if (formattedStr.includes("M")) {
    multiplier = 1000000;
    formattedStr = formattedStr.replace(/M\+?/g, "");
  } else if (formattedStr.includes("K")) {
    multiplier = 1000;
    formattedStr = formattedStr.replace(/K\+?/g, "");
  }
  
  formattedStr = formattedStr.replace(/\+/g, "");

  return formattedStr ? Math.round(Number(formattedStr) * multiplier) : 0;
}
