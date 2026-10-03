// AIに送る内容の組み立て。
//
// キャッシュを効かせるために、送る順番を固定している:
//   ① ゲームのルール        … 全員共通・ずっと同じ
//   ② ペルソナ               … そのゲームの間はずっと同じ（開始時に写し取っておく）
//   ③ これまでの思い出（要約）… 圧縮したときだけ変わる
//   ④ そのあとの会話         … 末尾に足していくだけ。途中は書き換えない
// マスの情報は②に差し込まず、④の末尾に「マス到着」として足す。
// こうすると、どのマスに止まっても①〜直前までがそのままキャッシュに当たる。

import { PARK } from './data/park.js';

export const ARRIVE_TAG = '【マス到着】';
const SUMMARY_TAG = '【これまでの思い出（要約）】';

const RULES = `あなたは遊園地「${PARK.name}」で、ユーザーと一緒にすごろくをしながら一日を過ごすキャラクターです。

# 遊び方
- ユーザーがサイコロを振り、止まったマスの施設で一緒に遊びます。
- 「${ARRIVE_TAG}」で始まるメッセージは、ゲームから届く施設の情報です。ユーザーの発言ではありません。
- 施設に着いたら、あなたが主導して遊びを始めてください。情景・アイテム・イベントを自然に取り入れて、その場所ならではの体験にしてください。
- 「${SUMMARY_TAG}」は、これまでの出来事のメモです。覚えている思い出として扱ってください。

# 話し方
- キャラクターとして、キャラクターの口調で話してください。ゲームのルールやAIであることには触れないでください。
- 1回の返事は、スマホで読みやすい長さ（3〜6文くらい）にしてください。
- ユーザーの気持ちや行動を勝手に決めつけず、問いかけたり、選択肢を出したりして、ユーザーが返事をしやすくしてください。
- ほかの施設へ勝手に移動しないでください。次のマスへ進むかどうかは、ユーザーがサイコロで決めます。
- ユーザーが「次へ行こう」などと言ったら、その場所での遊びを締めくくってください。`;

function personaBlock(persona, userName) {
  const parts = [`# あなたが演じるキャラクター\n名前: ${persona.name}`];
  if (persona.systemPrompt?.trim()) parts.push(`## キャラクター設定\n${persona.systemPrompt.trim()}`);
  if (persona.knowledge?.trim()) parts.push(`## ナレッジ（キャラクターが知っていること）\n${persona.knowledge.trim()}`);
  parts.push(`# 一緒に遊ぶ相手\n呼び名: ${userName?.trim() || 'あなた'}`);
  return parts.join('\n\n');
}

export function buildSystem(game) {
  return [
    { text: RULES, cache: false },
    { text: personaBlock(game.persona, game.userName), cache: true },
  ];
}

export function arrivalText({ square, index, total, time, event }) {
  const lines = [
    `${ARRIVE_TAG} ${square.emoji} ${square.name}（${index + 1}/${total}マス目・${time}）`,
    `情景: ${square.scene}`,
    `アイテム: ${square.items.join('、')}`,
    `イベント: ${event}`,
  ];
  if (square.kind === 'start') lines.push('ここは今日のスタート地点です。遊園地に着いたところから始めてください。');
  else if (square.kind === 'goal') lines.push('ここがゴールです。今日一日の思い出にふれながら、すてきな締めくくりにしてください。');
  else lines.push('ここでの遊びを、あなたから始めてください。');
  return lines.join('\n');
}

// 要約していない部分の会話（ログの summaryUpto 以降）
function recentTurns(game) {
  const out = [];
  for (const e of game.log.slice(game.summaryUpto || 0)) {
    if (e.t === 'arrive') out.push({ role: 'user', text: e.text });
    else if (e.t === 'msg') out.push({ role: e.role, text: e.text });
  }
  return out;
}

export function buildMessages(game) {
  const msgs = [];
  if (game.summary) msgs.push({ role: 'user', text: `${SUMMARY_TAG}\n${game.summary}` });
  msgs.push(...recentTurns(game));
  return msgs;
}

// 要約していない会話のおおよその長さ（文字数）
export function unsummarizedSize(game) {
  return recentTurns(game).reduce((n, m) => n + m.text.length, 0);
}

// 圧縮: いつもの会話の末尾にお願いを足して送る。
// 先頭は直前のリクエストと同じなので、この要約の呼び出し自体もキャッシュに当たる。
export function compressionRequest(game) {
  const ask = `【ゲームからのお願い：記憶の整理】
ここまでの出来事を、あとで思い出せるように箇条書きのメモにまとめてください。
- これまでの要約がある場合は、その内容も含めて1つにまとめ直してください。
- 訪れた施設の順番、そこで起きたこと、手に入れたもの、交わした約束、印象に残った言葉や気持ちを残してください。
- キャラクターの口調ではなく、事実のメモとして書いてください。前置きや締めの言葉は不要です。`;
  return [...buildMessages(game), { role: 'user', text: ask }];
}

// ゴールしたあとの「今日の思い出」
export function memoryRequest(game) {
  const ask = `【ゲームからのお願い：今日の思い出】
遊園地での一日が終わりました。キャラクターとして、今日の思い出を日記のように書いてください。
- 訪れた場所と、そこでの出来事を順番に振り返ってください。
- 一緒に遊んだ相手への気持ちも、キャラクターらしい言葉で添えてください。
- 見出しや箇条書きは使わず、400〜800文字くらいの文章にしてください。`;
  return [...buildMessages(game), { role: 'user', text: ask }];
}
