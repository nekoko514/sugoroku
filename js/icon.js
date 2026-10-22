// 線画アイコンを SVG の要素にする。形は js/data/icons.js
import { ICONS, FACILITY_ICON } from './data/icons.js';

const NS = 'http://www.w3.org/2000/svg';

// アイコンの線を <g> にまとめて返す（24×24 の座標のまま）。地図の中に置くとき用
export function iconGroup(name, attrs = {}) {
  const g = document.createElementNS(NS, 'g');
  for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, String(v));
  for (const [tag, a] of ICONS[name] || ICONS.sparkle) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) node.setAttribute(k, v);
    g.append(node);
  }
  return g;
}

// 文章の中に置く <svg>。大きさと色は CSS（.icon）で決める
export function icon(name, cls = 'icon') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(iconGroup(name));
  return svg;
}

export function facilityIcon(squareId) {
  return FACILITY_ICON[squareId] || 'sparkle';
}
