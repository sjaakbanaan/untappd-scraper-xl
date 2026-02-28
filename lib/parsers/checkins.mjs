import * as cheerio from "cheerio";
import { USER } from "../config.mjs";

/**
 * Parse all checkin items from a profile feed page (initial or paginated).
 */
export function parseCheckins(html) {
  const $ = cheerio.load(html);
  const checkins = [];

  $(".item[data-checkin-id]").each((_, el) => {
    const $el = $(el);
    const checkinId = Number($el.attr("data-checkin-id"));

    // Text block: "User is drinking a Beer by Brewery at Venue"
    const $text = $el.find(".checkin .top p.text, .checkin .top .text");

    // Beer
    const $beerLink = $text.find('a[href*="/b/"]');
    const beerName = $beerLink.text().trim();
    const beerUrl = $beerLink.attr("href")
      ? `https://untappd.com${$beerLink.attr("href")}`
      : null;

    // Brewery
    const $breweryLink = $text
      .find("a")
      .filter((_, a) => {
        const href = $(a).attr("href") || "";
        return (
          !href.includes("/b/") &&
          !href.includes("/v/") &&
          !href.includes("/user/") &&
          href !== "#"
        );
      })
      .first();
    const breweryName = $breweryLink.text().trim();
    const breweryUrl = $breweryLink.attr("href")
      ? `https://untappd.com${$breweryLink.attr("href")}`
      : null;

    // Venue
    const $venueLink = $text.find('a[href*="/v/"]').first();
    const venueName = $venueLink.text().trim() || null;
    const venueUrl = $venueLink.attr("href")
      ? `https://untappd.com${$venueLink.attr("href")}`
      : null;

    // Purchased at
    const $purchased = $el.find(".checkin-comment p.purchased a").first();
    const purchasedAt = $purchased.length
      ? {
          name: $purchased.text().trim(),
          url: `https://untappd.com${$purchased.attr("href")}`,
        }
      : null;

    // Rating
    const $caps = $el.find(".caps[data-rating]");
    const rating = $caps.length ? Number($caps.attr("data-rating")) : null;

    // Serving type
    const $serving = $el.find("p.serving span");
    const servingType = $serving.length ? $serving.text().trim() : null;

    // User comment
    const $commentBlock = $el.find(".checkin-comment").clone();
    $commentBlock.find("p.purchased, .rating-serving, .tagged-friends, .badge, span.badge").remove();
    const commentText = $commentBlock.text().trim().replace(/\s+/g, " ");
    const comment = commentText || null;

    // Timestamp
    const $time = $el.find("a.time, a.timezoner, .time.timezoner").first();
    const dateStr = $time.text().trim();
    let createdAt = null;
    if (dateStr) {
      try {
        const d = new Date(dateStr);
        createdAt = isNaN(d.getTime()) ? dateStr : d.toISOString();
      } catch {
        createdAt = dateStr;
      }
    }

    // Photo
    const $photo = $el.find(".photo img, .checkin-media img");
    const photoUrl = $photo.attr("data-original") || $photo.attr("src") || null;

    // Beer label image
    const $label = $el.find(".top .label img, .top a.label img");
    const labelUrl = $label.attr("data-original") || $label.attr("src") || null;

    // Toasts
    const $cheers = $el.find(".cheers");
    const toastCount = Number($cheers.find(".count span").text().trim()) || 0;
    const toastUsers = [];
    $cheers.find("a.user-toasts").each((_, a) => {
      const username = $(a).attr("data-user-name");
      if (username) toastUsers.push(username);
    });

    // Tagged friends
    const taggedFriends = [];
    $el.find(".tagged-friends a[href*='/user/']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const username = href.split("/user/")[1]?.replace(/\/$/, "");
      if (username) taggedFriends.push(username);
    });

    // Badges
    const badges = [];
    $el.find("span.badge").each((_, badge) => {
      const $badge = $(badge);
      const badgeText = $badge.find("span").text().trim();
      const $badgeImg = $badge.find("img");
      const badgeImageUrl = $badgeImg.attr("src") || null;
      const badgeName = $badgeImg.attr("alt") || badgeText.replace(/^Earned the\s+/, "").replace(/\s+badge!$/, "");

      if (badgeText || badgeName) {
        badges.push({
          name: badgeName,
          text: badgeText,
          image_url: badgeImageUrl,
        });
      }
    });

    checkins.push({
      checkin_id: checkinId,
      checkin_url: `https://untappd.com/user/${USER}/checkin/${checkinId}`,
      created_at: createdAt,
      beer: {
        name: beerName || null,
        url: beerUrl,
        label_url: labelUrl,
      },
      brewery: {
        name: breweryName || null,
        url: breweryUrl,
      },
      venue: venueName ? { name: venueName, url: venueUrl } : null,
      purchased_at: purchasedAt,
      rating,
      serving_type: servingType,
      comment,
      photo_url: photoUrl,
      toasts: { count: toastCount, users: toastUsers },
      comment_count: $el.find(".comments .comments-container .comment").length,
      tagged_friends: taggedFriends,
      badges,
    });
  });

  return checkins;
}
