"use client";

import { useEffect, useState } from "react";

export interface LiveBadge {
  badge_label: string;
  badge_type: string;
  discount_percent: number;
  base_price: number;
  final_price: number;
  promotion_id: string;
  promotion_name: string;
}

export type BadgeMap = Record<string, LiveBadge>;

/**
 * Live promotion badge + effective price for a set of products.
 *
 * Returns a map keyed by product id. Products with no live promotion are
 * absent from the map, which is the caller's signal to fall back to the
 * product's own badge and price. Fetch failures degrade silently to that
 * same fallback rather than blanking the grid.
 */
export function useLiveBadges(productIds: string[]): BadgeMap {
  const [badges, setBadges] = useState<BadgeMap>({});
  const key = productIds.join(",");

  useEffect(() => {
    if (!key) {
      setBadges({});
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    fetch(`/api/pricing/badges?product_ids=${encodeURIComponent(key)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { data: {} }))
      .then((json: { data?: BadgeMap }) => {
        if (!cancelled) setBadges(json.data ?? {});
      })
      .catch(() => {
        if (!cancelled) setBadges({});
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key]);

  return badges;
}
