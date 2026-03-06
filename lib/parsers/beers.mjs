import * as cheerio from "cheerio";
import { parseAbbreviatedNumber } from "../utils.mjs";

/**
 * Parse beer-level stats and metadata from a beer detail page
 * (e.g. https://untappd.com/b/brewery-name/beer-id).
 */
export function parseBeerDetails(html) {
  const $ = cheerio.load(html);
  const $content = $(".content");

  const $globalCaps = $content.find(".details .caps[data-rating]");
  const globalRating = $globalCaps.length ? Number($globalCaps.attr("data-rating")) : null;

  const abvText = $content.find("p.abv").text().trim();
  const abvMatch = abvText.match(/([\d.]+)\s*%/);
  const abv = abvMatch ? Number(abvMatch[1]) : null;

  const ibuText = $content.find("p.ibu").text().trim();
  const ibuMatch = ibuText.match(/(\d+)\s*IBU/);
  const ibu = ibuMatch ? Number(ibuMatch[1]) : null;

  const style = $content.find("p.style").text().trim() || null;


  const ratersText = $content.find("p.raters").text().trim();
  const ratersMatch = ratersText.match(/([\d,]+)\s*Rating/i);
  const totalRatings = ratersMatch ? Number(ratersMatch[1].replace(/,/g, "")) : null;

  const stats = {};
  $content.find(".stats p").each((_, p) => {
    const label = $(p).find(".stat").text().trim().replace(/\s*\(.*\)/, "").toLowerCase();
    const rawValue = $(p).find(".count").text();
    
    if (label && rawValue.trim() && !label.includes("you")) {
      stats[label] = parseAbbreviatedNumber(rawValue) || 0;
    }
  });

  return {
    global_rating: globalRating,
    global_rating_count: totalRatings,
    abv,
    ibu,
    style,
    total_checkins: stats.total || null,
    unique_users: stats.unique || null,
    monthly_checkins: stats.monthly || null,
  };
}
