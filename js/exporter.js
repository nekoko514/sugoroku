// 遊んだ一日を持ち帰るためのエクスポート。
// Markdown は読む用（サイコロとマスの区切りつき）、JSON は「続きから遊ぶ」用。
// どちらにも APIキーは含めない。

import { PARK, SQUARES } from './data/park.js';
import { secretById } from './data/secrets.js';

const squareById = Object.fromEntries(SQUARES.map((s) => [s.id, s]));

function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function toMarkdown(game) {
  const persona = game.persona;
  const me = game.userName?.trim() || 'あなた';
  const out = [];
  out.push(`# ${PARK.name}の夢の記録`);
  out.push('');
  out.push(`- 日付: ${fmtDate(game.startedAt)}`);
  out.push(`- 一緒に遊んだ子: ${persona.emoji || ''} ${persona.name}`);
  out.push(`- あなた: ${me}`);
  out.push(`- サイコロを振った回数: ${game.rolls}回`);
  out.push('');

  let pendingRoll = null;
  for (const e of game.log) {
    if (e.t === 'roll') {
      pendingRoll = e;
    } else if (e.t === 'arrive') {
      const sq = squareById[e.square];
      out.push('---');
      out.push('');
      if (pendingRoll) {
        out.push(`## 🎲 ${pendingRoll.n}投目：${pendingRoll.value}が出た → ${sq.emoji} ${sq.name}に止まった`);
        if (pendingRoll.route) {
          out.push('');
          out.push(`🪧 分かれ道で「${pendingRoll.route}」を選んだ`);
        }
        pendingRoll = null;
      } else {
        out.push(`## ${sq.emoji} ${sq.name}からスタート`);
      }
      out.push('');
      out.push(`*${(e.step ?? e.index) + 1}マス目・${e.time}*`);
      out.push('');
      for (const id of e.links || []) {
        out.push(`*✨ 持ち物の「${secretById(id)?.name}」が、ここでつながった*`);
        out.push('');
      }
    } else if (e.t === 'msg') {
      const who = e.role === 'assistant' ? persona.name : me;
      out.push(`**${who}**：${e.text.replace(/\n/g, '  \n')}`);
      out.push('');
      if (e.ambient) {
        out.push(`*♪ ${e.ambient}*`);
        out.push('');
      }
      for (const id of e.finds || []) {
        out.push(`*✨ 見つけたもの：${secretById(id)?.name}*`);
        out.push('');
      }
    }
  }

  if (game.memory) {
    out.push('---');
    out.push('');
    out.push(`## 📔 ${persona.name}の夢日記`);
    out.push('');
    out.push(game.memory);
    out.push('');
  }
  return out.join('\n');
}

export function toJson(game) {
  return JSON.stringify({ format: 'sugoroku-save', version: 1, exportedAt: new Date().toISOString(), game }, null, 2);
}

export function parseSave(text) {
  const j = JSON.parse(text);
  if (j?.format !== 'sugoroku-save' || !j.game?.log || !j.game?.persona) {
    throw new Error('このファイルは、すごろくのセーブデータではないみたい。');
  }
  return j.game;
}

export function fileBaseName(game) {
  const d = new Date(game.startedAt);
  const p = (n) => String(n).padStart(2, '0');
  const safe = (game.persona.name || 'persona').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
  return `sugoroku_${safe}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// iPhone では共有シート（「ファイルに保存」など）を優先し、使えなければダウンロードする
export async function saveFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // 共有シートを閉じただけ
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
