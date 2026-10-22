// すごろくの地図。マス（丸）を道でつないで、SVGで描く。
// 地図の形は js/data/park.js の ROUTE / DECOR で決める。

import { SQUARES, ROUTE, DECOR, MAP_SIZE, START } from './data/park.js';
import { iconGroup, facilityIcon } from './icon.js';

const NS = 'http://www.w3.org/2000/svg';
const NODE_R = 20;

export const NODES = Object.fromEntries(SQUARES.map((sq) => [sq.id, { ...sq, ...ROUTE[sq.id] }]));

// 次に進めるマス。分かれ道なら複数
export function nextChoices(id) {
  const n = NODES[id];
  if (n.branches) return n.branches;
  if (n.next) return [{ to: n.next }];
  return [];
}

// スタートから何マス目か（どちらの道を通っても同じになるように地図を作ってある）
const STEP = (() => {
  const step = { [START]: 0 };
  const queue = [START];
  while (queue.length) {
    const id = queue.shift();
    for (const c of nextChoices(id)) {
      if (step[c.to] == null) {
        step[c.to] = step[id] + 1;
        queue.push(c.to);
      }
    }
  }
  return step;
})();

export const TOTAL_STEPS = Math.max(...Object.values(STEP)) + 1;

export function stepOf(id) {
  return STEP[id] ?? 0;
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

// 2つのマスを、少しふくらんだ曲線の道でつなぐ
function roadPath(a, b) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(26, len * 0.18);
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return { d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`, cx, cy };
}

function edges() {
  const out = [];
  for (const id of Object.keys(NODES)) {
    for (const c of nextChoices(id)) out.push({ from: id, to: c.to, label: c.label });
  }
  return out;
}

/**
 * 地図を描く。古い園内案内図のように、紙（夜は紺）の上に細い線で描く。
 * state: { position, trail: [通ったマスのid], piece: コマに入れる一文字, choices: [選べるマスのid] }
 * onTap(id): マスをタップしたとき
 */
export function renderMap(container, state, onTap) {
  const { w, h } = MAP_SIZE;
  const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, class: 'map', role: 'img', 'aria-label': 'すごろくの地図' });

  // 地の色（上は夜、下は昼。ごくうっすら）
  const defs = svg('defs');
  const grad = svg('linearGradient', { id: 'map-sky', x1: 0, y1: 0, x2: 0, y2: 1 });
  [['0', 'stop-night'], ['0.28', 'stop-dusk'], ['0.55', 'stop-day'], ['1', 'stop-grass']]
    .forEach(([o, cls]) => grad.append(svg('stop', { offset: o, class: cls })));
  defs.append(grad);
  root.append(defs);
  root.append(svg('rect', { x: 0, y: 0, width: w, height: h, fill: 'url(#map-sky)' }));

  // 等高線のような、丘の細い線
  const contours = svg('g', { class: 'contours', 'aria-hidden': 'true' });
  for (const [cx, cy, rx, ry] of HILLS) {
    for (const k of [1, 0.7, 0.42]) contours.append(svg('ellipse', { cx, cy, rx: rx * k, ry: ry * k }));
  }
  root.append(contours);

  // 二重の枠
  root.append(svg('rect', { class: 'frame', x: 7, y: 7, width: w - 14, height: h - 14 }));
  root.append(svg('rect', { class: 'frame thin', x: 11, y: 11, width: w - 22, height: h - 22 }));

  // 題字
  const title = svg('g', { class: 'cartouche', transform: 'translate(112 58)', 'aria-hidden': 'true' });
  title.append(svg('text', { class: 'cartouche-name', x: 0, y: 0, 'text-anchor': 'middle' }, 'ゆめいろパーク'));
  title.append(svg('line', { x1: -70, y1: 12, x2: 70, y2: 12 }));
  title.append(svg('text', { class: 'cartouche-sub', x: 0, y: 27, 'text-anchor': 'middle' }, 'PARK GUIDE MAP'));
  root.append(title);

  // 飾り（線画）
  const decor = svg('g', { class: 'decor', 'aria-hidden': 'true' });
  for (const d of DECOR) {
    decor.append(iconGroup(d.i, { transform: `translate(${d.x - d.s / 2} ${d.y - d.s / 2}) scale(${d.s / 24})` }));
  }
  root.append(decor);
  root.append(compassRose(w - 52, h - 66));

  // 道
  const trail = state.trail || [];
  const walked = new Set(trail.slice(1).map((id, i) => `${trail[i]}>${id}`));
  const roads = svg('g', { class: 'roads' });
  const labels = svg('g', { class: 'branch-labels' });
  for (const e of edges()) {
    const a = NODES[e.from];
    const b = NODES[e.to];
    const { d } = roadPath(a, b);
    const cls = walked.has(`${e.from}>${e.to}`) ? ' walked' : '';
    roads.append(svg('path', { d, class: `road-side${cls}` }));
    roads.append(svg('path', { d, class: `road${cls}` }));
    roads.append(svg('path', { d, class: `road-dash${cls}` }));
    if (e.label) {
      // 分かれ道の看板は、分かれ道のマスの左右に立てる（施設の名前と重ならないように）
      const dir = b.x < a.x ? -1 : 1;
      const text = dir < 0 ? `← ${e.label}` : `${e.label} →`;
      const width = e.label.length * 11 + 34;
      const lx = a.x + dir * (NODE_R + 12 + width / 2);
      const g = svg('g', { class: 'sign', transform: `translate(${lx} ${a.y})` });
      g.append(svg('rect', { x: -width / 2, y: -11, width, height: 22, rx: 2 }));
      g.append(svg('text', { x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text));
      labels.append(g);
    }
  }
  root.append(roads);

  // マス：金の細いふちのメダルに、線画のアイコン
  const nodes = svg('g', { class: 'nodes' });
  const visited = new Set(trail);
  const choices = new Set(state.choices || []);
  const s = (NODE_R * 0.95) / 24;
  for (const n of Object.values(NODES)) {
    const cls = ['node', `kind-${n.kind}`];
    if (n.id === state.position) cls.push('here');
    else if (visited.has(n.id)) cls.push('past');
    if (choices.has(n.id)) cls.push('choice');
    const g = svg('g', { class: cls.join(' '), transform: `translate(${n.x} ${n.y})`, 'data-id': n.id, tabindex: 0, role: 'button', 'aria-label': n.name });
    g.append(svg('circle', { class: 'node-ring', r: NODE_R + 8 }));
    g.append(svg('circle', { class: 'node-outer', r: NODE_R + 3.5 }));
    g.append(svg('circle', { class: 'node-face', r: NODE_R }));
    g.append(iconGroup(facilityIcon(n.id), { class: 'node-icon', transform: `translate(${-12 * s} ${-12 * s}) scale(${s})` }));
    g.append(svg('text', { class: 'node-label', y: NODE_R + 17, 'text-anchor': 'middle' }, n.name));
    g.addEventListener('click', () => onTap?.(n.id));
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onTap?.(n.id); } });
    nodes.append(g);
  }
  root.append(nodes);
  root.append(labels);

  // コマ：ペルソナの名前の一文字を入れた、金のピン
  const here = NODES[state.position];
  if (here) {
    const piece = svg('g', { class: 'piece', transform: `translate(${here.x + 17} ${here.y - 15})`, 'aria-hidden': 'true' });
    const bob = svg('g', { class: 'piece-bob' });
    bob.append(svg('ellipse', { class: 'piece-shadow', cx: 0, cy: 1, rx: 5, ry: 1.6 }));
    bob.append(svg('path', { class: 'piece-pin', d: 'M0 0C-4 -6 -12 -13 -12 -24a12 12 0 0 1 24 0C12 -13 4 -6 0 0z' }));
    bob.append(svg('circle', { class: 'piece-face', cy: -24, r: 8.6 }));
    bob.append(svg('text', { class: 'piece-mark', y: -23.4, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, state.piece || '・'));
    piece.append(bob);
    root.append(piece);
  }

  container.replaceChildren(root);
  return root;
}

// 地図の角の方位磁針
function compassRose(cx, cy) {
  const g = svg('g', { class: 'compass', transform: `translate(${cx} ${cy})`, 'aria-hidden': 'true' });
  g.append(svg('circle', { r: 22 }));
  g.append(svg('circle', { class: 'thin', r: 18 }));
  g.append(svg('path', { d: 'M0 -26 4 -4 26 0 4 4 0 26 -4 4 -26 0 -4 -4z' }));
  g.append(svg('path', { class: 'fill', d: 'M0 -26 4 -4 0 0z M26 0 4 4 0 0z M0 26 -4 4 0 0z M-26 0 -4 -4 0 0z' }));
  g.append(svg('text', { y: -31, 'text-anchor': 'middle' }, 'N'));
  return g;
}

// 等高線を描く丘（中心x, 中心y, 横の半径, 縦の半径）
const HILLS = [
  [300, 760, 92, 58], [56, 470, 84, 50], [60, 1150, 110, 64], [304, 1000, 96, 56],
  [180, 1760, 140, 84], [44, 2130, 92, 60], [330, 2290, 88, 52],
];

// 今いるマスが画面の真ん中に来るようにスクロールする
export function scrollToNode(container, id, smooth = true) {
  const g = container.querySelector(`.node[data-id="${id}"]`);
  g?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
}
