import * as cheerio from "cheerio";

/**
 * Parse the flavor profile tags from an individual checkin page.
 * Returns an array of flavor strings, e.g. ["Hoppy", "Grapefruity"].
 */
export function parseCheckinFlavors(html) {
  const $ = cheerio.load(html);
  const flavors = [];
  $(".flavor ul li span").each((_, el) => {
    const text = $(el).text().trim();
    if (text) flavors.push(text);
  });
  return flavors;
}

/**
 * Parse live activity stats from an individual checkin page.
 * Returns updated toasts (count + users) and comment_count.
 */
export function parseCheckinStats(html) {
  const $ = cheerio.load(html);

  // Toasts
  const $cheers = $(".cheers");
  const toastCount = Number($cheers.find(".count span").text().trim()) || 0;
  const toastUsers = [];
  $cheers.find("a.user-toasts").each((_, a) => {
    const username = $(a).attr("data-user-name");
    if (username) toastUsers.push(username);
  });

  // Comment count
  const commentCount = $(".comments .comments-container .comment").length;

  return {
    toasts: { count: toastCount, users: toastUsers },
    comment_count: commentCount,
  };
}
