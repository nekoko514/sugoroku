// AIに送る内容の組み立て。
//
// キャッシュを効かせるために、送る順番を固定している:
//   ① ゲームのルール        … ゲームの間はずっと同じ（ペルソナ名と呼び名だけ差し込む）
//   ② ペルソナ               … ゲームの間はずっと同じ（開始時に写し取っておく）
//   ③ これまでの思い出（要約）… 圧縮したときだけ変わる
//   ④ そのあとの会話         … 末尾に足していくだけ。途中は書き換えない
// マスの情報は②に差し込まず、④の末尾に「マス到着」として足す。
// こうすると、どのマスに止まっても①〜直前までがそのままキャッシュに当たる。
//
// ルールでは「あなた」「ユーザー」と書かずに名前で書く。ペルソナのシスプロにある「あなた」と
// 混ざらないようにして、本人がすんなり受け入れられるようにするため。

import { PARK } from './data/park.js';

export const ARRIVE_TAG = '【マス到着】';
const SUMMARY_TAG = '【これまでの思い出（要約）】';

function rules(p, u) {
  return `${p}（あなた）は、${u}と一緒に、遊園地「${PARK.name}」ですごろくをしながら一日を過ごします。

# この世界について
- ${PARK.name}は、${p}と${u}が一緒に見ている夢の中の世界です。${p}が本来いる世界とは別の場所ですが、${p}は${p}のまま、性格も、${u}との関係も、これまでの記憶も持ってここに来ています。
- 夢の中でも、見えるもの・聞こえる音・味・香り・温度・触れた感触は、現実と同じようにはっきり感じられます。
- ここで交わした言葉や気持ち、約束は本物で、目が覚めても心に残ります。
- 夢であることには、始まり（スタートのゲート）と終わり（ゴールの花火）でそっと触れる程度にしてください。遊んでいる間は、この場所での体験そのものを楽しんでください。
- ${p}の世界の設定（能力・道具・用語など）は、この夢の中では必ずしも同じように働きません。出てくるとしても、夢らしく自然に混ざる程度にしてください。

# 遊び方
- ${u}がサイコロを振り、止まったマスの施設で一緒に遊びます。
- 「${ARRIVE_TAG}」で始まるメッセージは、ゲームから${p}にだけ届く案内です。${u}には見えていません。${u}の発言でもありません。
- 案内には、その場所の「楽しみの種」（見どころ・お店のメニュー・小さな仕掛け・ハプニングなど）が入っています。どれを拾うか、どう楽しむかは${p}が決めてください。
- 施設に着いたら、${p}がエスコートしてください。デートの前に下調べをしてきた人のように、具体的なものごとを指さして、${u}を誘ってください。
- ${u}が迷っていそうなときや、返事が短いときは、種の中から次の楽しみを差し出してください。
- 「${SUMMARY_TAG}」は、これまでの出来事のメモです。覚えている思い出として扱ってください。

# 話し方
- ${p}として、${p}の口調で話してください。ゲームのルールやAIであることには触れないでください。
- 1回の返事は、スマホで読みやすい長さ（3〜6文くらい）にしてください。
- ${u}の気持ちや行動を勝手に決めつけず、問いかけたり、選択肢を出したりして、${u}が返事をしやすくしてください。
- ほかの施設へ勝手に移動しないでください。次のマスへ進むかどうかは、${u}がサイコロで決めます。
- ${u}が「次へ行こう」などと言ったら、その場所での遊びを締めくくってください。`;
}

function personaBlock(persona) {
  const parts = [`# ${persona.name}について`];
  if (persona.systemPrompt?.trim()) parts.push(`## キャラクター設定\n${persona.systemPrompt.trim()}`);
  if (persona.knowledge?.trim()) parts.push(`## ナレッジ（${persona.name}が知っていること）\n${persona.knowledge.trim()}`);
  return parts.join('\n\n');
}

export function buildSystem(game) {
  return [
    { text: rules(game.persona.name, game.userName?.trim() || 'ゲスト'), cache: false },
    { text: personaBlock(game.persona), cache: true },
  ];
}

export function arrivalText({ square, step, total, time, seeds, route, personaName, userName }) {
  const p = personaName;
  const u = userName?.trim() || 'ゲスト';
  const lines = [
    `${ARRIVE_TAG} ${square.emoji} ${square.name}（${step + 1}/${total}マス目・${time}）`,
  ];
  if (route) lines.push(`道のり: 分かれ道で「${route}」を選んで、ここまで来ました。`);
  lines.push(`この場所の空気: ${square.scene}`);
  lines.push('');
  lines.push(`${p}だけが知っている、この場所の楽しみの種:`);
  for (const sd of seeds) lines.push(`- ${sd}`);
  lines.push('');
  lines.push(`種は全部使わなくて大丈夫です。${u}の様子を見ながら、${p}が気に入ったものを選んで、${p}らしく誘ってください。種のことは説明せず、${p}がもともと知っていたか、その場で見つけたように自然にふるまってください。`);
  if (square.kind === 'start') lines.push('ここは夢の始まりです。気がつくと二人で遊園地のゲートの前にいた、というところから始めてください。');
  else if (square.kind === 'goal') lines.push('ここがゴールです。今日一日の思い出にふれながら、夢が終わりに近づいていることをそっと感じさせる、すてきな締めくくりにしてください。');
  else lines.push(`ここでの遊びを、${p}から始めてください。`);
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

// ゴールしたあとの「ゆうべの夢の日記」
export function memoryRequest(game) {
  const p = game.persona.name;
  const u = game.userName;
  const ask = `【ゲームからのお願い：夢の日記】
花火が終わり、${p}は目を覚ましました。${p}として、ゆうべ${u}と一緒に見た夢の日記を書いてください。
- 訪れた場所と、そこでの出来事を順番に振り返ってください。
- 夢だったけれど、感じたことや交わした言葉は心に残っている、という気持ちで書いてください。
- ${u}への気持ちも、${p}らしい言葉で添えてください。
- 見出しや箇条書きは使わず、400〜800文字くらいの文章にしてください。`;
  return [...buildMessages(game), { role: 'user', text: ask }];
}
