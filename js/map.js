// すごろくの地図。マス（丸）を道でつないで、SVGで描く。
// 地図の形は js/data/park.js の ROUTE / DECOR で決める。

import { SQUARES, ROUTE, DECOR, MAP_SIZE, START } from './data/park.js';

const NS = 'http://www.w3.org/2000/svg';
const NODE_R = 25;

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
 * 地図を描く。
 * state: { position, trail: [通ったマスのid], piece: コマの絵文字, choices: [選べるマスのid] }
 * onTap(id): マスをタップしたとき
 */
export function renderMap(container, state, onTap) {
  const { w, h } = MAP_SIZE;
  const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, class: 'map', role: 'img', 'aria-label': 'すごろくの地図' });

  // 空（上は夜、下は昼の芝生）
  const defs = svg('defs');
  const grad = svg('linearGradient', { id: 'map-sky', x1: 0, y1: 0, x2: 0, y2: 1 });
  [['0', 'stop-night'], ['0.28', 'stop-dusk'], ['0.55', 'stop-day'], ['1', 'stop-grass']]
    .forEach(([o, cls]) => grad.append(svg('stop', { offset: o, class: cls })));
  defs.append(grad);
  root.append(defs);
  root.append(svg('rect', { x: 0, y: 0, width: w, height: h, rx: 28, fill: 'url(#map-sky)' }));

  // ふんわりした丘
  const hills = svg('g', { class: 'hills' });
  [[60, 1180, 150, 90], [300, 1120, 140, 80], [180, 960, 190, 110], [40, 760, 120, 90], [330, 640, 120, 100], [180, 470, 170, 90]]
    .forEach(([cx, cy, rx, ry]) => hills.append(svg('ellipse', { cx, cy, rx, ry })));
  root.append(hills);

  // 飾り
  const decor = svg('g', { class: 'decor', 'aria-hidden': 'true' });
  for (const d of DECOR) decor.append(svg('text', { x: d.x, y: d.y, 'font-size': d.s, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, d.e));
  root.append(decor);

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
      const width = (e.label.length + 1.5) * 12 + 14;
      const lx = a.x + dir * (NODE_R + 10 + width / 2);
      const ly = a.y + 2;
      const g = svg('g', { class: 'sign', transform: `translate(${lx} ${ly})` });
      g.append(svg('rect', { x: -width / 2, y: -12, width, height: 24, rx: 12 }));
      g.append(svg('text', { x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, `${dir < 0 ? '◀ ' : ''}${e.label}${dir > 0 ? ' ▶' : ''}`));
      labels.append(g);
    }
  }
  root.append(roads);

  // マス
  const nodes = svg('g', { class: 'nodes' });
  const visited = new Set(trail);
  const choices = new Set(state.choices || []);
  for (const n of Object.values(NODES)) {
    const cls = ['node', `kind-${n.kind}`];
    if (n.id === state.position) cls.push('here');
    else if (visited.has(n.id)) cls.push('past');
    if (choices.has(n.id)) cls.push('choice');
    const g = svg('g', { class: cls.join(' '), transform: `translate(${n.x} ${n.y})`, 'data-id': n.id, tabindex: 0, role: 'button', 'aria-label': n.name });
    g.append(svg('circle', { class: 'node-ring', r: NODE_R + 7 }));
    g.append(svg('circle', { class: 'node-side', cy: 6, r: NODE_R }));
    g.append(svg('circle', { class: 'node-face', r: NODE_R }));
    g.append(svg('ellipse', { class: 'node-shine', cx: -7, cy: -11, rx: 11, ry: 6 }));
    g.append(svg('text', { class: 'node-emoji', y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 24 }, n.emoji));
    g.append(svg('text', { class: 'node-label', y: NODE_R + 18, 'text-anchor': 'middle' }, n.name));
    g.addEventListener('click', () => onTap?.(n.id));
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onTap?.(n.id); } });
    nodes.append(g);
  }
  root.append(nodes);
  root.append(labels);

  // コマ
  const here = NODES[state.position];
  if (here) {
    const piece = svg('g', { class: 'piece', transform: `translate(${here.x + 20} ${here.y - 30})`, 'aria-hidden': 'true' });
    const bob = svg('g', { class: 'piece-bob' });
    bob.append(svg('ellipse', { class: 'piece-shadow', cx: 0, cy: 26, rx: 12, ry: 4 }));
    bob.append(svg('circle', { class: 'piece-side', cy: 3, r: 18 }));
    bob.append(svg('circle', { class: 'piece-face', r: 18 }));
    bob.append(svg('text', { y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 20 }, state.piece || '🙂'));
    piece.append(bob);
    root.append(piece);
  }

  container.replaceChildren(root);
  return root;
}

// 今いるマスが画面の真ん中に来るようにスクロールする
export function scrollToNode(container, id, smooth = true) {
  const g = container.querySelector(`.node[data-id="${id}"]`);
  g?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
}
